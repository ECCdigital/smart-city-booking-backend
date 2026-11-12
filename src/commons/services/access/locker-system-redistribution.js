const BookingManager = require("../../data-managers/booking-manager");
const AccessLogService = require("./access-log-service");
const LockerSystemMutex = require("./locker-system-mutex");
const {
  accessBufferMs,
  assignedCompartmentOf,
  bookablesById,
  claimOf,
  compartmentPointId,
  freeCompartments,
  holdingsOf,
} = require("./compartment-allocation");
const { compartmentsOf } = require("./locker-system-compartments");

/** Where a booking's access window stands, seen from now. */
const WINDOW = Object.freeze({
  FUTURE: "future",
  RUNNING: "running",
  OVER: "over",
});

/**
 * A Fach leaves the Zuteilung of its Schließfachanlage (tickets#1043): the
 * administration takes it out of service, or out of the Anlage. Saving the
 * Anlage then gives the future bookings at it - their access window has not
 * begun, unpaid ones included - the first free Fach in service, under the
 * mutex of the Anlage. Running bookings keep their Fach, there may be things
 * in it already. A future booking no Fach is free for stays at the old one
 * and is named, for the administration to solve by hand.
 *
 * Before the save, the administration reads which running and future
 * bookings hang at the Fächer (`bookingsAt`), to ask before it saves.
 *
 * The platform never takes a Fach out of service by itself - not after
 * `door_jammed` either. Only the save of an Anlage gets here.
 */
class LockerSystemRedistribution {
  /**
   * The Fächer of the Anlage that leave its Zuteilung with the save: gone
   * from its list, or out of service now and in service before.
   *
   * @param {Object|null} before The Anlage as stored
   * @param {Object} after The Anlage as the save leaves it
   * @returns {string[]} Their UUIDs
   */
  static leavingCompartmentIds(before, after) {
    const remaining = new Map(
      compartmentsOf(after).map((compartment) => [
        String(compartment.id),
        compartment,
      ]),
    );

    return compartmentsOf(before)
      .filter((compartment) => {
        const kept = remaining.get(String(compartment.id));
        return (
          !kept ||
          (compartment.outOfService !== true && kept.outOfService === true)
        );
      })
      .map((compartment) => String(compartment.id));
  }

  /**
   * The running and future bookings that hold one of the Fächer at the
   * Anlage - what the administration is told before a Fach leaves it. A
   * booking whose access window is over is no longer at the Fach.
   *
   * @param {string} tenant Tenant ID
   * @param {Object} lockerSystem The Anlage
   * @param {string[]} compartmentIds UUIDs of the Fächer
   * @param {Object} [options]
   * @param {number} [options.now]
   * @param {number} [options.limit] How many to name; `total` counts all
   * @returns {Promise<{ total: number, bookings: Object[] }>} Each one with
   *   `state` `running` or `future` and the `compartment` it holds
   */
  static async bookingsAt(
    tenant,
    lockerSystem,
    compartmentIds,
    { now = Date.now(), limit = Infinity } = {},
  ) {
    const holdings = (
      await LockerSystemRedistribution._holdings(
        tenant,
        lockerSystem,
        compartmentIds,
        now,
      )
    ).filter(({ state }) => state !== WINDOW.OVER);

    return {
      total: holdings.length,
      bookings: holdings
        .slice(0, limit)
        .map(({ booking, entry, state }) =>
          LockerSystemRedistribution._named(booking, entry, state),
        ),
    };
  }

  /**
   * Stores the Anlage, and when Fächer leave its Zuteilung, moves the
   * future bookings at them - both under the mutex of the Anlage, so no
   * Vormerkung gives out a Fach in between.
   *
   * @param {string} tenant Tenant ID
   * @param {Object|null} before The Anlage as stored, `null` on a create
   * @param {Object} after The Anlage as the save leaves it
   * @param {() => Promise<Object>} store Stores `after`, answers the
   *   stored Anlage
   * @param {Object} [options]
   * @param {number} [options.now]
   * @param {string} [options.userId] Who saves, for the access log
   * @returns {Promise<{ accessPoint: Object, unmoved: Object[] }>} The
   *   stored Anlage and the future bookings that stay at their Fach
   */
  static async storeRedistributing(
    tenant,
    before,
    after,
    store,
    { now = Date.now(), userId = null } = {},
  ) {
    const leaving = LockerSystemRedistribution.leavingCompartmentIds(
      before,
      after,
    );
    if (leaving.length === 0) {
      return { accessPoint: await store(), unmoved: [] };
    }

    return LockerSystemMutex.hold(after, async () => {
      const accessPoint = await store();
      const unmoved = await LockerSystemRedistribution._redistribute(
        tenant,
        accessPoint,
        leaving,
        { now, userId },
      );
      return { accessPoint, unmoved };
    });
  }

  /** Moves the future bookings at the Fächer; answers the ones that stay. */
  static async _redistribute(tenant, lockerSystem, compartmentIds, options) {
    const holdings = await LockerSystemRedistribution._holdings(
      tenant,
      lockerSystem,
      compartmentIds,
      options.now,
    );
    const unmoved = [];

    for (const { booking, entry, bookable, state } of holdings) {
      if (state !== WINDOW.FUTURE) {
        continue;
      }

      const from = entry.assignedCompartment;
      const [free] = await freeCompartments(
        tenant,
        lockerSystem,
        claimOf(booking, bookable),
        { exclude: LockerSystemRedistribution._heldBy(booking, entry) },
      );

      if (!free) {
        unmoved.push(LockerSystemRedistribution._named(booking, entry));
        await LockerSystemRedistribution._log(tenant, lockerSystem, booking, {
          compartment: from,
          result: "failure",
          errorCode: "compartments_unavailable",
          errorMessage: "No free compartment in service to move to",
          payload: { compartment: from },
          userId: options.userId,
        });
        continue;
      }

      entry.assignedCompartment = assignedCompartmentOf(free);
      await BookingManager.storeBooking(booking);
      await LockerSystemRedistribution._log(tenant, lockerSystem, booking, {
        compartment: entry.assignedCompartment,
        result: "success",
        payload: { compartment: entry.assignedCompartment, movedFrom: from },
        userId: options.userId,
      });
    }

    return unmoved;
  }

  /**
   * Every not-taken-back entry of a booking - not rejected, cancelled or
   * withdrawn - at the Anlage that holds one of the Fächer, with the
   * state of its access window, earliest first.
   */
  static async _holdings(tenant, lockerSystem, compartmentIds, now) {
    const found = (await holdingsOf(tenant, compartmentIds)).filter(
      ({ entry }) => String(entry.accessPointId) === String(lockerSystem.id),
    );

    const bookables = await bookablesById(
      tenant,
      found.map(({ entry }) => entry.bookableId),
    );

    return found
      .map(({ booking, entry }) => {
        const bookable = bookables.get(String(entry.bookableId)) ?? null;
        return {
          booking,
          entry,
          bookable,
          state: LockerSystemRedistribution._stateOf(booking, bookable, now),
        };
      })
      .sort(
        (a, b) =>
          (a.booking.timeBegin ?? 0) - (b.booking.timeBegin ?? 0) ||
          String(a.booking.id).localeCompare(String(b.booking.id)),
      );
  }

  /**
   * Where the booking's access window stands: `future` before it begins,
   * `over` after it ended, `running` in between - and for a booking
   * without a period, which holds its Fach for good.
   */
  static _stateOf(booking, bookable, now) {
    if (booking.timeBegin == null || booking.timeEnd == null) {
      return WINDOW.RUNNING;
    }
    const { beforeMs, afterMs } = accessBufferMs(bookable);
    if (now < booking.timeBegin - beforeMs) {
      return WINDOW.FUTURE;
    }
    if (now > booking.timeEnd + afterMs) {
      return WINDOW.OVER;
    }
    return WINDOW.RUNNING;
  }

  /** The Fächer the booking holds in its other entries. */
  static _heldBy(booking, entry) {
    return (booking.accessInfo || [])
      .filter(
        (other) =>
          other !== entry && !other.revokedAt && other.assignedCompartment,
      )
      .map((other) => String(other.assignedCompartment.id));
  }

  static _named(booking, entry, state) {
    return {
      id: booking.id,
      name: booking.name ?? null,
      mail: booking.mail ?? null,
      timeBegin: booking.timeBegin ?? null,
      timeEnd: booking.timeEnd ?? null,
      ...(state ? { state } : {}),
      compartment: entry.assignedCompartment,
    };
  }

  /**
   * One row of the access log per booking moved or left, at the Fach -
   * `<anlageId>:<UUID>`, as the Zuteilung writes it.
   */
  static async _log(
    tenant,
    lockerSystem,
    booking,
    {
      compartment,
      result,
      payload,
      errorCode = null,
      errorMessage = null,
      userId,
    },
  ) {
    try {
      await AccessLogService.log({
        tenantId: tenant,
        bookingId: booking.id,
        accessPointId: compartmentPointId(lockerSystem.id, compartment.id),
        accessPointType: lockerSystem.type,
        provider: lockerSystem.provider,
        externalId: lockerSystem.externalId || null,
        action: "hold",
        actor: { userId, source: userId ? "user" : "system" },
        result,
        payload,
        errorCode,
        errorMessage,
      });
    } catch {
      // The access log never fails the save of the Anlage.
    }
  }
}

module.exports = LockerSystemRedistribution;
