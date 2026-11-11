const BookingManager = require("../../data-managers/booking-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");
const {
  getBookingBufferMs,
  overlapsBufferedInterval,
} = require("../../availability/booking-buffer");
const { compartmentsOf } = require("./locker-system-compartments");
const { DOMAIN } = require("../authorization/reach");

/**
 * The Zuteilung of a Fach (tickets#1039): which Fächer of a
 * Schließfachanlage with its own list are free for a booking's period, and
 * in which order the platform gives them out. The platform checks the
 * occupancy itself, because Open Locker knows no bookings.
 *
 * A Fach is occupied for a booking when another booking - not rejected,
 * cancelled or withdrawn, unpaid ones included - holds it in an entry not
 * taken back (`assignedCompartment.id`), at whichever Anlage of the tenant,
 * and
 * 1. their access windows overlap - each booking's period with the access
 *    buffer of its own bookable - or
 * 2. this booking's period falls into the other one's, widened by the
 *    booking buffer of the other one's bookable, as the availability counts.
 *
 * So the larger of the two buffers holds. Reading the occupancy, choosing
 * and saving belong under the mutex of the Anlage (`LockerSystemMutex`);
 * nothing here holds it.
 *
 * A claim is the booking asking: `{ bookingId, timeBegin, timeEnd,
 * bookable }` - its own entries are never counted against it, and its
 * bookable gives its access buffer.
 */

/**
 * The access buffer of a bookable (`accessPointDetails.accessBuffer`, in
 * minutes) in milliseconds; none where it has none.
 *
 * @param {Object|null|undefined} bookable
 * @returns {{ beforeMs: number, afterMs: number }}
 */
function accessBufferMs(bookable) {
  const buffer = bookable?.accessPointDetails?.accessBuffer || {};

  const toMs = (minutes) =>
    Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : 0;

  return {
    beforeMs: toMs(Number(buffer.before ?? 0)),
    afterMs: toMs(Number(buffer.after ?? 0)),
  };
}

/**
 * The Fächer in the order the platform gives them out: by Schließfachschrank
 * name, for the same name by its id, then by number, numerically.
 *
 * @param {Object[]} compartments Entries of an Anlage's list
 * @returns {Object[]} A sorted copy
 */
function inAllocationOrder(compartments) {
  const text = (value) => (value == null ? "" : String(value));
  const number = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  };

  return [...compartments].sort(
    (a, b) =>
      text(a.lockerBank?.name).localeCompare(text(b.lockerBank?.name), "de") ||
      text(a.lockerBank?.id).localeCompare(text(b.lockerBank?.id)) ||
      number(a.number) - number(b.number),
  );
}

/**
 * Which of the Fächer another booking of the tenant occupies for the claim.
 *
 * @param {string} tenant Tenant ID
 * @param {string[]} compartmentIds UUIDs of the Fächer to ask for
 * @param {{ bookingId: string, timeBegin: number, timeEnd: number,
 *   bookable: Object|null }} claim The booking asking
 * @returns {Promise<Set<string>>} The UUIDs occupied
 */
async function occupiedCompartmentIds(tenant, compartmentIds, claim) {
  const asked = new Set(compartmentIds.map(String));
  const others = (
    await BookingManager.getBookingsHoldingCompartments(
      tenant,
      [...asked],
      DOMAIN,
    )
  ).filter(
    (booking) =>
      !booking.isRejected && String(booking.id) !== String(claim.bookingId),
  );

  const holdings = others.flatMap((booking) =>
    (booking.accessInfo || [])
      .filter(
        (entry) =>
          !entry.revokedAt && asked.has(String(entry.assignedCompartment?.id)),
      )
      .map((entry) => ({ booking, entry })),
  );
  const bookables = await bookablesById(
    tenant,
    holdings.map(({ entry }) => entry.bookableId),
  );

  const occupied = new Set();
  for (const { booking, entry } of holdings) {
    if (overlaps(claim, booking, bookables.get(String(entry.bookableId)))) {
      occupied.add(String(entry.assignedCompartment.id));
    }
  }
  return occupied;
}

/**
 * The Fächer of the Anlage that are free for the claim and in service, in
 * the order the platform gives them out.
 *
 * @param {string} tenant Tenant ID
 * @param {Object} accessPoint The Anlage, carrying its own list
 * @param {Object} claim The booking asking, see `occupiedCompartmentIds`
 * @param {Object} [options]
 * @param {Iterable<string>} [options.exclude] UUIDs to leave out besides -
 *   those the booking holds or was given already
 * @returns {Promise<Object[]>} Entries of the Anlage's list
 */
async function freeCompartments(
  tenant,
  accessPoint,
  claim,
  { exclude = [] } = {},
) {
  const excluded = new Set([...exclude].map(String));
  const candidates = compartmentsOf(accessPoint).filter(
    (compartment) =>
      compartment.outOfService !== true &&
      !excluded.has(String(compartment.id)),
  );
  if (candidates.length === 0) {
    return [];
  }

  const occupied = await occupiedCompartmentIds(
    tenant,
    candidates.map((compartment) => String(compartment.id)),
    claim,
  );
  return inAllocationOrder(
    candidates.filter((compartment) => !occupied.has(String(compartment.id))),
  );
}

/**
 * The Fach as a booking's entry keeps it (`assignedCompartment`).
 *
 * @param {Object} compartment An entry of an Anlage's list
 * @returns {{ id: string, number: number|null,
 *   lockerBank: { id: string, name: string }|null }}
 */
function assignedCompartmentOf(compartment) {
  return {
    id: String(compartment.id),
    number: compartment.number ?? null,
    lockerBank: compartment.lockerBank
      ? {
          id: compartment.lockerBank.id ?? null,
          name: compartment.lockerBank.name ?? null,
        }
      : null,
  };
}

/** Whether the other booking's hold of a Fach touches the claim. */
function overlaps(claim, other, otherBookable) {
  if (
    claim.timeBegin == null ||
    claim.timeEnd == null ||
    other.timeBegin == null ||
    other.timeEnd == null
  ) {
    return true;
  }

  const own = accessBufferMs(claim.bookable);
  const theirs = accessBufferMs(otherBookable);
  const accessWindowsOverlap =
    claim.timeBegin - own.beforeMs < other.timeEnd + theirs.afterMs &&
    other.timeBegin - theirs.beforeMs < claim.timeEnd + own.afterMs;
  if (accessWindowsOverlap) {
    return true;
  }

  const { beforeMs, afterMs } = getBookingBufferMs(otherBookable);
  return overlapsBufferedInterval(
    claim.timeBegin,
    claim.timeEnd,
    other.timeBegin,
    other.timeEnd,
    beforeMs,
    afterMs,
  );
}

async function bookablesById(tenant, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) {
    return new Map();
  }
  const bookables = await BookableManager.getBookablesByIds(
    tenant,
    unique,
    DOMAIN,
  );
  return new Map(bookables.map((bookable) => [String(bookable.id), bookable]));
}

module.exports = {
  accessBufferMs,
  inAllocationOrder,
  occupiedCompartmentIds,
  freeCompartments,
  assignedCompartmentOf,
};
