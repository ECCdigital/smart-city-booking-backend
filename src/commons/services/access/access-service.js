const bunyan = require("bunyan");
const { getAccessProvider } = require("./providers/access-provider-registry");
const AccessProvider = require("./providers/access-provider");
const BookingManager = require("../../data-managers/booking-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");
const AccessPointManager = require("../../data-managers/access-point-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const PermissionsService = require("../permission-service");
const SecurityUtils = require("../../utilities/security-utils");
const GrantCleanupService = require("./grant-cleanup-service");
const AccessLogService = require("./access-log-service");
const { decide, satisfy } = require("./access-decision");
const { projectAccessPoint } = require("./access-point-projection");
const { AccessPointMode } = require("../../entities/access/access-point");
const { AccessPointType } = require("../../schemas/accessPointSchema");
const { RolePermission } = require("../../entities/role/role");
const MailController = require("../../mail-service/mail-controller");
const { ForbiddenError, ConflictError } = require("../../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "access-service.js",
  level: process.env.LOG_LEVEL,
});

/**
 * The hold of a provider that holds nothing on its side: the stored booking
 * is the claim, and the platform checks the capacity of the bookable.
 */
const PLATFORM_HOLD = Object.freeze({
  holdId: null,
  expiresAt: null,
  compartment: null,
});

/**
 * Until the migration of the locker fold (step 4) moves them into
 * `accesspoints`, locker systems are configured at the bookable as
 * `lockerDetails.units`. The resolver stands in for their rows with
 * synthesized ones under this prefix: `locker:<provider>:<externalId>`.
 * The migration remaps the entries made under such an id.
 */
const CONFIGURED_LOCKER_SYSTEM_PREFIX = "locker:";
const IFBS = "ifbs";

class AccessService {
  /**
   * Opens an access point linked to a booking.
   *
   * Runs the access decision (`access-decision.js`) in its two steps: the
   * booking checks (committed, paid, in window, ownership) apply to everyone,
   * and on top of them the access point's own validation rules demand evidence
   * that the person is really at the door. A refused attempt is audited
   * (`result: "denied"`) and reported as a soft failure instead of throwing,
   * so callers can render the reasons. Only a booking or access point that
   * cannot be resolved at all (nothing to audit against) and provider errors
   * after a passed check are raised as errors.
   *
   * @param {string} tenant
   * @param {string} bookingId
   * @param {string} accessPointId
   * @param {string} userId
   * @param {Object} [options]
   * @param {boolean} [options.hasManagePermission=false] Replaces booking
   *   ownership, and exempts the user from the evidence rules at a booking
   *   that is not theirs - at their own they present evidence like anyone else
   * @param {Object[]} [options.evidence=[]] Evidence the client sent, e.g. a
   *   scanned code
   * @param {string|null} [options.channel=null] How the client says it reached
   *   the door. Recorded as reported, never part of the decision.
   * @returns {Promise<{ success: true, data: { openProcessId: string|null } }
   *   | { success: false, blockingReasons: string[] }>} The started open - with
   *   the process to poll, or `null` when the door is already dealt with - or
   *   the prioritized reasons for the refusal. The reasons are empty when the
   *   user may not access the booking at all, as ownership has no own reason.
   *   A door that only takes a code (`mode: authorization`) has no remote way
   *   in and refuses with `no_remote_access`, whoever asks.
   * @throws {ForbiddenError} The booking does not exist or does not include
   *   the access point.
   */
  static async open(tenant, bookingId, accessPointId, userId, options = {}) {
    return this._openGuarded(
      "open",
      tenant,
      bookingId,
      accessPointId,
      userId,
      options,
    );
  }

  /**
   * Unlatches an access point linked to a booking, i.e. pulls the latch so the
   * door physically opens instead of only releasing the lock.
   *
   * Behind the same guard as {@link open} - the decision and the evidence -
   * because it opens the same door. Where a lock can pull its latch, `open` does so by
   * itself, so this is the older way to the same end and no client needs it.
   *
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @param {string} accessPointId Access point ID
   * @param {string} userId Acting user
   * @param {Object} [options] As of {@link open}
   * @returns {Promise<{ success: true, data: { openProcessId: string|null } }
   *   | { success: false, blockingReasons: string[] }>} As of {@link open}
   * @throws {ForbiddenError} The booking does not exist or does not include
   *   the access point.
   */
  static async unlatch(tenant, bookingId, accessPointId, userId, options = {}) {
    return this._openGuarded(
      "unlatch",
      tenant,
      bookingId,
      accessPointId,
      userId,
      options,
    );
  }

  /**
   * @private
   * The guarded way through a door: the decision, then the evidence, then the
   * provider - and an audit entry whichever of the three has the last word.
   * Both actions that open an access point run through here, so neither can
   * end up with the weaker check.
   *
   * @param {"open"|"unlatch"} action What to ask the provider for, which is
   *   also what the audit entry is filed under
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @param {string} accessPointId Access point ID
   * @param {string} userId Acting user
   * @param {Object} options As of {@link open}
   * @returns {Promise<Object>} As of {@link open}
   */
  static async _openGuarded(
    action,
    tenant,
    bookingId,
    accessPointId,
    userId,
    options,
  ) {
    const resolved = await this._resolve(tenant, bookingId, accessPointId);
    const { accessPoint, bookingContext, booking } = resolved;
    const channel = options.channel ?? null;

    const decision = decide(booking, [{ accessPoint, bookingContext }], {
      userId,
      canManage: options.hasManagePermission === true,
    });

    // Opening through the API is the remote way in, which a door that only
    // takes a code does not have - it may still be closed and asked for its
    // status. The decision was made for this one door, so its reasons already
    // say `no_remote_access` where that is what stands in the way.
    if (
      !decision.remoteOperableAccessPointIds.includes(String(accessPointId))
    ) {
      return this._denyOpen({
        action,
        tenant,
        userId,
        accessPoint,
        bookingId,
        blockingReasons: decision.blockingReasons,
        channel,
        accessRole: decision.accessRole,
      });
    }

    // The resolver handed the door over with its rules and the scan code they
    // are checked against; there is nothing left to read.
    const evidenceOutcome = satisfy(decision, accessPoint, options.evidence);

    if (!evidenceOutcome.satisfied) {
      return this._denyOpen({
        action,
        tenant,
        userId,
        accessPoint,
        bookingId,
        blockingReasons: evidenceOutcome.blockingReasons,
        channel,
        accessRole: decision.accessRole,
      });
    }

    try {
      const provider = getAccessProvider(accessPoint.provider);
      const outcome = await provider[action](accessPoint, bookingContext);

      await this._log({
        tenantId: tenant,
        userId,
        accessPoint,
        bookingId,
        action,
        result: "success",
        payload: {
          ...outcome,
          validatedEvidence: evidenceOutcome.validatedEvidence,
        },
        channel,
        accessRole: decision.accessRole,
        evidenceBypassed: evidenceOutcome.bypassed,
      });
      // The outcome says by itself whether polling is called for: a
      // pending open names its process, an opened door names none.
      return {
        success: true,
        data: { openProcessId: outcome.openProcessId },
      };
    } catch (err) {
      await this._log({
        tenantId: tenant,
        userId,
        accessPoint,
        bookingId,
        action,
        result: "failure",
        errorMessage: err.message,
        channel,
        accessRole: decision.accessRole,
        evidenceBypassed: evidenceOutcome.bypassed,
      });
      throw err;
    }
  }

  /**
   * @private
   * Records a refused open attempt and turns it into the soft failure the
   * caller reports. Both layers of the decision refuse the same way, so the
   * audit entry is written in one place.
   *
   * @param {Object} refusal
   * @param {"open"|"unlatch"} refusal.action What was refused
   * @param {string} refusal.tenant Tenant ID
   * @param {string} refusal.userId Acting user
   * @param {Object} refusal.accessPoint The access point that stays shut
   * @param {string} refusal.bookingId Booking the attempt was made for
   * @param {string[]} refusal.blockingReasons Prioritized reasons
   * @param {string|null} refusal.channel Channel as reported by the client
   * @param {"booker"|"manager"|null} refusal.accessRole The capacity the
   *   refused user acted in, `null` where they had none - refusing a booker
   *   and refusing a stranger are two different entries in the audit
   * @returns {Promise<{ success: false, blockingReasons: string[] }>} The refusal
   */
  static async _denyOpen({
    action,
    tenant,
    userId,
    accessPoint,
    bookingId,
    blockingReasons,
    channel,
    accessRole,
  }) {
    await this._log({
      tenantId: tenant,
      userId,
      accessPoint,
      bookingId,
      action,
      result: "denied",
      blockingReasons,
      channel,
      accessRole,
    });

    return { success: false, blockingReasons };
  }

  /**
   * Closes an access point linked to a booking.
   *
   * Answers with the state the lock is in afterwards, in the shape of
   * {@link getStatus}: the flow reports a fresh state after every action, and
   * saying it here saves the client a second call for it.
   *
   * The state is read from the lock rather than assumed from the command: a
   * lock takes its time to turn, so "closed" is only what the lock says it
   * is. A state that cannot be read is reported as unknown - the close itself
   * did go through.
   *
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @param {string} accessPointId Access point ID
   * @param {string} userId Acting user
   * @returns {Promise<Object>} The status after closing
   */
  static async close(tenant, bookingId, accessPointId, userId) {
    const { accessPoint, bookingContext } = await this._resolve(
      tenant,
      bookingId,
      accessPointId,
    );

    try {
      const provider = getAccessProvider(accessPoint.provider);
      await provider.close(accessPoint, bookingContext);

      await this._log({
        tenantId: tenant,
        userId,
        accessPoint,
        bookingId,
        action: "close",
        result: "success",
      });
      return this._readStatusAfterClose(provider, accessPoint, bookingContext);
    } catch (err) {
      await this._log({
        tenantId: tenant,
        userId,
        accessPoint,
        bookingId,
        action: "close",
        result: "failure",
        errorMessage: err.message,
      });
      throw err;
    }
  }

  /**
   * @private
   * The state of the lock right after it was closed. Read from the lock, not
   * derived from the command that was sent - what a close means for the bolt
   * is the lock's answer, not the caller's assumption.
   *
   * A lock that cannot be read afterwards answers "nothing known": the close
   * was carried out and audited either way, so it must not be turned into a
   * failure here.
   *
   * @param {Object} provider The provider of the access point
   * @param {Object} accessPoint The access point that was closed
   * @param {Object} bookingContext The booking it was closed for
   * @returns {Promise<Object>} The status as of {@link _toStatusResponse}
   */
  static async _readStatusAfterClose(provider, accessPoint, bookingContext) {
    try {
      return this._toStatusResponse(
        await this._readLockStatus(provider, accessPoint, bookingContext),
        "provider_status",
      );
    } catch (err) {
      logger.warn(
        `Could not read access point ${accessPoint.id} after closing it: ${err.message}`,
      );
      return this._toStatusResponse(AccessProvider.unknownLockStatus, null);
    }
  }

  /**
   * Returns the state of an open attempt: the running process where there is
   * one, the last event the door reported otherwise, and the lock's own state
   * as the last resort. `statusSource` says which of the three answered.
   *
   * The provider is asked for the progress of a process only where it
   * declares `getOpenProgress` - a process id at a provider that opens
   * synchronously is nothing to poll.
   *
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @param {string} accessPointId Access point ID
   * @param {string|null} openProcessId The process an open answered with
   * @returns {Promise<Object>} The status of the open attempt, as of
   *   {@link _toOpenStatusResponse}
   */
  static async getOpenStatus(tenant, bookingId, accessPointId, openProcessId) {
    const { accessPoint, bookingContext } = await this._resolve(
      tenant,
      bookingId,
      accessPointId,
    );
    const provider = getAccessProvider(accessPoint.provider);
    const canReportProgress =
      provider.constructor.capabilities.includes("getOpenProgress");
    let payload;
    let response;

    if (openProcessId && canReportProgress) {
      const progress = await provider.getOpenProgress(
        accessPoint,
        openProcessId,
      );
      payload = progress;
      response = this._toOpenStatusResponse(progress, "open_process");
    } else if (bookingContext.lastEvent) {
      const { lastEvent } = bookingContext;
      const progress = {
        confirmed: lastEvent.success === true,
        confirmedAt: lastEvent.timestamp || null,
        errorCode: null,
        errorMessage: null,
      };
      payload = { ...progress, event: lastEvent };
      response = this._toOpenStatusResponse(progress, "last_event");
    } else {
      const lockStatus = await this._readLockStatus(
        provider,
        accessPoint,
        bookingContext,
      );
      payload = lockStatus;
      response = {
        ...this._toStatusResponse(lockStatus, "provider_status"),
        confirmed: null,
        errorCode: null,
        errorMessage: null,
      };
    }

    await this._log({
      tenantId: tenant,
      accessPoint,
      bookingId,
      action: "status",
      result: "success",
      payload,
      actor: { source: "system" },
    });

    return response;
  }

  /**
   * Returns the current state of an access point as the lock reports it.
   *
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @param {string} accessPointId Access point ID
   * @returns {Promise<Object>} The status of the access point
   */
  static async getStatus(tenant, bookingId, accessPointId) {
    const { accessPoint, bookingContext } = await this._resolve(
      tenant,
      bookingId,
      accessPointId,
    );

    const provider = getAccessProvider(accessPoint.provider);
    const lockStatus = await this._readLockStatus(
      provider,
      accessPoint,
      bookingContext,
    );

    await this._log({
      tenantId: tenant,
      accessPoint,
      bookingId,
      action: "status",
      result: "success",
      payload: lockStatus,
      actor: { source: "system" },
    });

    return this._toStatusResponse(lockStatus, "provider_status");
  }

  /**
   * @private
   * The state of the lock as the provider reports it, or unknown on every
   * count where the provider declares no `getStatus` - a locker system
   * that only confirms an open process has nothing to say about a box at
   * rest, and the service asks nothing an adapter does not declare.
   *
   * @param {Object} provider The provider of the access point
   * @param {Object} accessPoint The access point to read
   * @param {Object} bookingContext The booking it is read for
   * @returns {Promise<Object>} A LockStatus
   */
  static async _readLockStatus(provider, accessPoint, bookingContext) {
    if (!provider.constructor.capabilities.includes("getStatus")) {
      return AccessProvider.unknownLockStatus;
    }

    return provider.getStatus(accessPoint, bookingContext);
  }

  /**
   * @private
   * A lock status as the API hands it out: the three fields of the
   * provider's LockStatus and where the answer came from. The adapters
   * answer in this shape already - there is nothing to read out of them.
   *
   * `null` carries meaning and is not `false`: it says the provider does not
   * report this.
   *
   * @param {import("./providers/access-provider").LockStatus} lockStatus
   *   The provider's answer
   * @param {string|null} statusSource Where the answer came from
   * @returns {{ open: boolean|null, locked: boolean|null,
   *   doorOpen: boolean|null, statusSource: string|null }} The status
   */
  static _toStatusResponse(lockStatus, statusSource) {
    return { ...lockStatus, statusSource };
  }

  /**
   * @private
   * The status of an open attempt, read off its progress: a confirmed open
   * is an open, unlocked door; one not confirmed is not open, and whether
   * the lock is thrown is unknown; a progress the provider could not tell
   * is unknown on every count. The door itself is never reported by a
   * process - only a sensor can.
   *
   * @param {import("./providers/access-provider").OpenProgress} progress
   *   How far the attempt has come
   * @param {string|null} statusSource Where the answer came from
   * @returns {Object} The fields of {@link _toStatusResponse} plus
   *   `confirmed`, `errorCode` and `errorMessage`
   */
  static _toOpenStatusResponse(progress, statusSource) {
    const lockStatus =
      progress.confirmed === true
        ? { open: true, locked: false, doorOpen: null }
        : progress.confirmed === false
          ? { open: false, locked: null, doorOpen: null }
          : AccessProvider.unknownLockStatus;

    return {
      ...this._toStatusResponse(lockStatus, statusSource),
      confirmed: progress.confirmed,
      errorCode: progress.errorCode,
      errorMessage: progress.errorMessage,
    };
  }

  /**
   * Returns all access points of a booking, in the shape a client sees them.
   *
   * The projection is the same one a resolved scan goes through, so the person
   * at the door reads the same access point either way. What a client must not
   * learn - scan codes, provider configuration, external ids - stays on the
   * internal entries this is built from.
   *
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @param {Object} [options] The user asking, whose role at this booking
   *   decides what `validationRuleTypes` demands of them
   * @param {string|null} [options.userId=null] Acting user
   * @param {boolean} [options.hasManagePermission=false] Whether the user may
   *   manage the bookings of the tenant. It empties `validationRuleTypes` only
   *   at someone else's booking - at their own they are the booker and prove
   *   what the door demands, exactly as the open path decides it.
   * @returns {Promise<Object[]>} The access points of the booking
   */
  static async getByBooking(
    tenant,
    bookingId,
    { userId = null, hasManagePermission = false } = {},
  ) {
    const { booking, compartments, doors } = await this._getBookingAccessPoints(
      tenant,
      bookingId,
    );
    const entries = [...compartments, ...doors];
    const decision = decide(booking, entries, {
      userId,
      canManage: hasManagePermission,
    });

    return entries.map(({ accessPoint, bookingContext }) =>
      projectAccessPoint(accessPoint, { decision, bookingContext }),
    );
  }

  /**
   * @private
   * Compartments and doors of a booking as one list of internal entries,
   * compartments first. Everything that needs the full access point - the access decision,
   * the providers, the audit log - works on these; only the API boundary
   * projects them.
   *
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @returns {Promise<{ accessPoint: Object, bookingContext: Object }[]>}
   */
  static async _getBookingAccessPointEntries(tenant, bookingId) {
    const { compartments, doors } = await this._getBookingAccessPoints(
      tenant,
      bookingId,
    );

    return [...compartments, ...doors];
  }

  /**
   * Holds a compartment of every locker system the booking books, for a
   * booking not paid yet. One `accessInfo` entry per compartment is made at
   * the locker system's row - `bookableItem.amount` of them per system - and
   * each is held: by the provider where it holds compartments itself (iFBS
   * keeps a box for two minutes), by the stored booking where it does not
   * (Pareva). The platform-held ones are checked against the capacity of
   * the bookable after the booking is stored, so that two checkouts racing
   * for the last compartment cannot both get it: the occupancy of the
   * bookable in the booking's window, this booking included, must not
   * exceed `bookable.amount`.
   *
   * A hold the provider refuses, or a capacity that is exceeded, is thrown;
   * the checkout then rolls the booking back. Entries held or granted
   * already are left alone, so the call is safe to repeat; entries only
   * held beyond what the booking books now - an unpaid booking that was
   * changed - are dropped, their provider hold lapsing by itself.
   *
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @returns {Promise<Object[]>} The booking's `accessInfo`
   * @throws {ConflictError} `compartments_unavailable` when the bookable
   *   has no compartment left for this booking
   */
  static async holdForBooking(tenant, bookingId) {
    const { booking, lockerSystems } = await this._getBookingAccessPoints(
      tenant,
      bookingId,
    );

    this._trimHeldCompartments(booking, lockerSystems);
    this._ensureCompartmentEntries(booking, lockerSystems);

    const platformHeld = new Map();
    for (const entry of this._compartmentEntries(booking)) {
      const system = lockerSystems.get(String(entry.accessPointId));
      if (!system || entry.revokedAt || entry.grant || entry.hold) {
        continue;
      }

      const provider = getAccessProvider(system.accessPoint.provider);
      if (!provider.constructor.capabilities.includes("hold")) {
        Object.assign(entry, { hold: { ...PLATFORM_HOLD } });
        if (system.bookable) {
          platformHeld.set(String(entry.accessPointId), system);
        }
        continue;
      }

      const accessPoint = this._compartmentAccessPoint(system, entry);
      try {
        const hold = await provider.hold(
          accessPoint,
          this._compartmentContext(tenant, booking, system, entry),
        );
        Object.assign(entry, {
          hold: this._toStoredHold(hold),
          compartment: hold.compartment ?? null,
          metadata: hold.metadata ?? null,
        });
        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId,
          action: "hold",
          result: "success",
          payload: { hold: entry.hold },
          actor: { source: "system" },
        });
      } catch (err) {
        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId,
          action: "hold",
          result: "failure",
          errorMessage: err.message,
          actor: { source: "system" },
        });
        throw err;
      }
    }

    await BookingManager.storeBooking(booking);

    for (const system of platformHeld.values()) {
      await this._assertCompartmentCapacity(tenant, booking, system);
    }

    return booking.accessInfo;
  }

  /**
   * Renews the holds of the given bookings before their payment starts,
   * where the provider holds compartments itself and its hold lapses.
   * iFBS hands out a box afresh, which may be another one; a compartment
   * such a provider never held for - an entry the checkout made without a
   * hold - is held now. A provider that holds nothing has nothing to renew,
   * and neither has a compartment granted already. A hold that is lost and
   * cannot be taken again is thrown; the checkout answers it as the
   * compartment being unavailable.
   *
   * @param {string} tenant Tenant ID
   * @param {string[]} bookingIds The bookings about to be paid
   * @returns {Promise<void>}
   */
  static async refreshHolds(tenant, bookingIds) {
    for (const bookingId of bookingIds) {
      const booking = await BookingManager.getBooking(bookingId, tenant);
      if (!booking) {
        continue;
      }

      const { lockerSystems } = await this._getBookingAccessPointsFromBooking(
        tenant,
        booking,
      );
      let renewed = false;

      for (const entry of this._compartmentEntries(booking)) {
        const system = lockerSystems.get(String(entry.accessPointId));
        if (!system || entry.revokedAt || entry.grant) {
          continue;
        }

        const provider = getAccessProvider(system.accessPoint.provider);
        if (!provider.constructor.capabilities.includes("refreshHold")) {
          continue;
        }

        const accessPoint = this._compartmentAccessPoint(system, entry);
        try {
          const context = this._compartmentContext(
            tenant,
            booking,
            system,
            entry,
          );
          const hold = entry.hold
            ? await provider.refreshHold(accessPoint, context)
            : await provider.hold(accessPoint, context);
          Object.assign(entry, {
            hold: this._toStoredHold(hold),
            compartment: hold.compartment ?? null,
            metadata: hold.metadata ?? entry.metadata ?? null,
          });
          renewed = true;
          await this._log({
            tenantId: tenant,
            accessPoint,
            bookingId,
            action: "hold",
            result: "success",
            payload: { hold: entry.hold, renewed: true },
            actor: { source: "system" },
          });
        } catch (err) {
          await this._log({
            tenantId: tenant,
            accessPoint,
            bookingId,
            action: "hold",
            result: "failure",
            errorMessage: err.message,
            actor: { source: "system" },
          });
          throw err;
        }
      }

      if (renewed) {
        await BookingManager.storeBooking(booking);
      }
    }
  }

  /**
   * Sets up the access of a booking: the doors it confers and the
   * compartments of the locker systems it books. A door is provisioned as
   * its mode says; a compartment is always provisioned through the grant,
   * whatever mode its locker system opens in, consuming the hold where one
   * was taken. Doors and compartments provisioned already are left alone.
   *
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @returns {Promise<Object[]>} The booking's `accessInfo`
   */
  static async provisionForBooking(tenant, bookingId) {
    const resolved = await this._getBookingAccessPoints(tenant, bookingId);

    return this._provisionResolved(tenant, resolved);
  }

  /**
   * @private
   * {@link provisionForBooking} on a booking resolved already, so that an
   * update can revoke on the same object it provisions afterwards.
   *
   * @param {string} tenant Tenant ID
   * @param {{ booking: Object, doors: Object[], lockerSystems?: Map }} resolved
   *   The booking with its doors and locker systems
   * @returns {Promise<Object[]>} The booking's `accessInfo`
   */
  static async _provisionResolved(tenant, { booking, doors, lockerSystems }) {
    const bookingId = booking.id;
    const provisionedAccessPoints = [];

    // A grant that fails after others went through leaves those at the
    // provider: the booking has to say so, or the next attempt grants them
    // twice and a revoke misses them. So what was done is stored either way.
    try {
      await this._provisionDoors(
        tenant,
        booking,
        doors,
        provisionedAccessPoints,
      );
      await this._provisionCompartments(tenant, booking, lockerSystems);
    } catch (err) {
      await BookingManager.storeBooking(booking);
      throw err;
    }

    await BookingManager.storeBooking(booking);
    await this._sendProvisionedMail(booking, provisionedAccessPoints);
    return booking.accessInfo;
  }

  /**
   * @private
   * Provisions the doors of the booking as their mode says: a remote door
   * is noted as provisioned, one that takes a code is granted at its
   * provider. Grants with a secret are collected for the mail.
   */
  static async _provisionDoors(
    tenant,
    booking,
    doors,
    provisionedAccessPoints,
  ) {
    const bookingId = booking.id;

    for (const { accessPoint, bookingContext } of doors) {
      if (accessPoint.mode === AccessPointMode.REMOTE) {
        if (bookingContext.isProvisioned) {
          continue;
        }

        this._upsertAccessInfo(booking, accessPoint, {
          isProvisioned: true,
          provisionedAt: Date.now(),
        });

        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId,
          action: "provision",
          result: "success",
          payload: { mode: AccessPointMode.REMOTE },
          actor: { source: "system" },
        });
        continue;
      }

      if (!this._usesAuthorization(accessPoint.mode)) {
        continue;
      }

      if (bookingContext.isProvisioned && bookingContext.grant) {
        continue;
      }

      const provider = getAccessProvider(accessPoint.provider);
      const supportedModes = await this._getSupportedModes(
        provider,
        accessPoint,
        tenant,
      );

      if (supportedModes && !supportedModes.includes(accessPoint.mode)) {
        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId,
          action: "provision",
          result: "failure",
          errorMessage: `Access mode '${accessPoint.mode}' is not supported by access point '${accessPoint.id}'`,
          actor: { source: "system" },
        });
        continue;
      }

      try {
        const grant = await provider.grantAuthorization(
          accessPoint,
          bookingContext,
        );

        // A fresh grant starts the entry over: whatever an earlier grant at
        // this door left - its revocation, its principal - is history.
        this._upsertAccessInfo(booking, accessPoint, {
          isProvisioned: true,
          provisionedAt: Date.now(),
          revokedAt: null,
          grant: this._toStoredGrant(grant),
          principalRemovedAt: null,
          principalCleanupAttemptedAt: null,
          principalCleanupError: null,
        });
        if (grant.secret) {
          provisionedAccessPoints.push({
            accessPointId: accessPoint.id,
            label: accessPoint.label || accessPoint.id,
            provider: accessPoint.provider,
            bookableTitle: accessPoint.bookableTitle || "",
            pin: grant.secret,
          });
        }

        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId,
          action: "provision",
          result: "success",
          payload: { grant: this._toAuditedGrant(grant) },
          actor: { source: "system" },
        });
      } catch (err) {
        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId,
          action: "provision",
          result: "failure",
          errorMessage: err.message,
          actor: { source: "system" },
        });
        throw err;
      }
    }
  }

  /**
   * @private
   * Grants every compartment of the booking not granted yet. The entries
   * are made where the checkout did not make them - a booking an admin
   * created - and a provider that holds compartments takes one on the spot
   * where the hold lapsed or was never taken. Every grant is audited under
   * the compartment's id; a refused one is rethrown after the audit, like a
   * door's.
   *
   * @param {string} tenant Tenant ID
   * @param {Object} booking The booking, written into
   * @param {Map<string, Object>|undefined} lockerSystems The locker systems
   *   the booking books, as the resolver answers them
   */
  static async _provisionCompartments(tenant, booking, lockerSystems) {
    if (!lockerSystems?.size) {
      return;
    }

    this._ensureCompartmentEntries(booking, lockerSystems);

    for (const entry of this._compartmentEntries(booking)) {
      const system = lockerSystems.get(String(entry.accessPointId));
      if (!system || entry.revokedAt || entry.grant) {
        continue;
      }

      const provider = getAccessProvider(system.accessPoint.provider);
      const heldAccessPoint = this._compartmentAccessPoint(system, entry);

      if (!provider.constructor.capabilities.includes("grantAuthorization")) {
        await this._log({
          tenantId: tenant,
          accessPoint: heldAccessPoint,
          bookingId: booking.id,
          action: "provision",
          result: "failure",
          errorMessage: `Provider '${system.accessPoint.provider}' grants no compartments`,
          actor: { source: "system" },
        });
        continue;
      }

      try {
        const grant = await provider.grantAuthorization(
          heldAccessPoint,
          this._compartmentContext(tenant, booking, system, entry),
        );

        Object.assign(entry, {
          isProvisioned: true,
          provisionedAt: Date.now(),
          revokedAt: null,
          grant: this._toStoredGrant(grant),
          hold: null,
          compartment:
            grant.compartment ??
            entry.hold?.compartment ??
            entry.compartment ??
            null,
          metadata: grant.metadata ?? entry.metadata ?? null,
          externalBookingId: String(grant.authorizationId),
          principalRemovedAt: null,
          principalCleanupAttemptedAt: null,
          principalCleanupError: null,
        });

        await this._log({
          tenantId: tenant,
          accessPoint: this._compartmentAccessPoint(system, entry),
          bookingId: booking.id,
          action: "provision",
          result: "success",
          payload: {
            grant: this._toAuditedGrant(grant),
            compartment: entry.compartment,
          },
          actor: { source: "system" },
        });
      } catch (err) {
        await this._log({
          tenantId: tenant,
          accessPoint: heldAccessPoint,
          bookingId: booking.id,
          action: "provision",
          result: "failure",
          errorMessage: err.message,
          actor: { source: "system" },
        });
        throw err;
      }
    }
  }

  /**
   * Takes the access of a booking back: the grants at its doors and the
   * compartments granted to it. A compartment only held is left alone -
   * the hold lapses by itself. The entries stay, marked revoked.
   *
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @returns {Promise<Object[]>} The booking's `accessInfo`
   */
  static async revokeForBooking(tenant, bookingId) {
    const { booking, doors, lockerSystems } =
      await this._getBookingAccessPoints(tenant, bookingId);

    await this._revokeResolvedDoors(tenant, booking, doors);
    await this._revokeCompartments(tenant, booking, lockerSystems);
    await BookingManager.storeBooking(booking);
    return booking.accessInfo;
  }

  /**
   * @private
   * Revokes every granted, unrevoked compartment of the booking at its
   * provider. A revoke the provider refuses is audited and left for the
   * next attempt, like a door's; the entry then stays granted.
   *
   * @param {string} tenant Tenant ID
   * @param {Object} booking The booking, written into
   * @param {Map<string, Object>|undefined} lockerSystems The locker systems
   *   of the booking's compartments
   */
  static async _revokeCompartments(tenant, booking, lockerSystems) {
    for (const entry of this._compartmentEntries(booking)) {
      const system = lockerSystems?.get(String(entry.accessPointId));
      if (!entry.grant || entry.revokedAt) {
        continue;
      }
      if (!system) {
        logger.warn(
          `${tenant} -- compartment ${this._compartmentId(entry)} of booking ${booking.id} has no locker system left to revoke at`,
        );
        continue;
      }

      const provider = getAccessProvider(system.accessPoint.provider);
      const accessPoint = this._compartmentAccessPoint(system, entry);

      try {
        const revocation = await provider.revokeAuthorization(
          accessPoint,
          this._toProviderGrant(entry.grant),
        );
        const now = Date.now();

        Object.assign(entry, {
          isProvisioned: false,
          revokedAt: now,
          hold: null,
          principalRemovedAt:
            revocation.principalRemoved === true
              ? now
              : entry.principalRemovedAt || null,
          principalCleanupError:
            revocation.principalRemoved === false
              ? GrantCleanupService.PRINCIPAL_NOT_REMOVED_ERROR
              : null,
        });

        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId: booking.id,
          action: "revoke",
          result: "success",
          payload: { grant: this._toAuditedGrant(entry.grant), revocation },
          actor: { source: "system" },
        });
      } catch (err) {
        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId: booking.id,
          action: "revoke",
          result: "failure",
          errorMessage: err.message,
          actor: { source: "system" },
        });
      }
    }
  }

  static async _revokeResolvedDoors(tenant, booking, doors) {
    for (const { accessPoint, bookingContext } of doors) {
      if (accessPoint.mode === AccessPointMode.REMOTE) {
        if (!bookingContext.isProvisioned) {
          continue;
        }

        this._upsertAccessInfo(booking, accessPoint, {
          isProvisioned: false,
          revokedAt: Date.now(),
        });

        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId: booking.id,
          action: "revoke",
          result: "success",
          payload: { mode: AccessPointMode.REMOTE },
          actor: { source: "system" },
        });
        continue;
      }

      if (!this._usesAuthorization(accessPoint.mode)) {
        continue;
      }

      const grant = bookingContext.grant;
      if (!grant) {
        continue;
      }

      const provider = getAccessProvider(accessPoint.provider);

      try {
        const revocation = await provider.revokeAuthorization(
          accessPoint,
          this._toProviderGrant(grant),
        );
        const now = Date.now();

        this._upsertAccessInfo(booking, accessPoint, {
          isProvisioned: false,
          revokedAt: now,
          principalRemovedAt:
            revocation.principalRemoved === true
              ? now
              : bookingContext.principalRemovedAt || null,
          principalCleanupError:
            revocation.principalRemoved === false
              ? GrantCleanupService.PRINCIPAL_NOT_REMOVED_ERROR
              : null,
        });

        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId: booking.id,
          action: "revoke",
          result: "success",
          payload: { grant: this._toAuditedGrant(grant), revocation },
          actor: { source: "system" },
        });
      } catch (err) {
        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId: booking.id,
          action: "revoke",
          result: "failure",
          errorMessage: err.message,
          actor: { source: "system" },
        });
      }
    }
  }

  /**
   * Re-sets the access of a booking that changed, after the change is
   * stored. Doors are revoked and provisioned afresh when the time or the
   * doors changed, as before. Compartments are revoked and provisioned
   * afresh when the time or the allocation changed - the locker systems
   * booked or the amount of compartments at any of them - since a
   * compartment is booked at the provider for one time and one booking.
   *
   * @param {string} tenant Tenant ID
   * @param {Object} oldBooking The booking as it was
   * @param {Object} newBooking The booking as it is stored now
   * @returns {Promise<Object[]>} The booking's `accessInfo`
   */
  static async updateForBooking(tenant, oldBooking, newBooking) {
    const changedTime =
      oldBooking.timeBegin !== newBooking.timeBegin ||
      oldBooking.timeEnd !== newBooking.timeEnd;
    const [oldResolved, newResolved] = await Promise.all([
      this._getBookingAccessPointsFromBooking(tenant, oldBooking),
      this._getBookingAccessPointsFromBooking(tenant, newBooking),
    ]);
    const changedDoors =
      this._doorKey(oldResolved.doors) !== this._doorKey(newResolved.doors);
    const changedCompartments =
      this._compartmentKey(oldResolved.lockerSystems) !==
      this._compartmentKey(newResolved.lockerSystems);

    if (!changedTime && !changedDoors && !changedCompartments) {
      return newBooking.accessInfo || [];
    }

    if (changedTime || changedDoors) {
      await this._revokeResolvedDoors(tenant, oldBooking, oldResolved.doors);
    }

    // The stored booking carries the compartments as they were granted, so
    // they are revoked on the very object that is provisioned afterwards.
    const resolved = await this._getBookingAccessPoints(tenant, newBooking.id);
    if (changedTime || changedCompartments) {
      await this._revokeCompartments(
        tenant,
        resolved.booking,
        resolved.lockerSystems,
      );
    }

    return this._provisionResolved(tenant, resolved);
  }

  /**
   * Checks whether a user may operate (open/close/status) the access points of
   * a booking.
   *
   * The booking must always be active (committed, paid if priced, not rejected
   * and within its time window) - this applies to everyone, including users
   * with the manage-bookings permission. The permission only replaces the
   * ownership requirement, it does not bypass the booking conditions.
   */
  static async canOperate(
    userId,
    tenant,
    bookingId,
    accessPointId,
    hasManagePermission,
  ) {
    const resolved = await this._tryResolve(tenant, bookingId, accessPointId);

    if (!resolved) {
      return false;
    }

    const { accessPoint, bookingContext, booking } = resolved;
    const decision = decide(booking, [{ accessPoint, bookingContext }], {
      userId,
      canManage: hasManagePermission,
    });

    return decision.operableAccessPointIds.includes(String(accessPointId));
  }

  /**
   * Checks whether a user may view (list) the access points assigned to a
   * booking. Unlike {@link canOperate} this does NOT require the booking to
   * be within its (buffered) time window - the assigned access points should
   * be visible at any time as long as the booking is valid (committed, paid
   * if priced, not rejected) and the user has a role at it: the owner or
   * someone with the manage-bookings permission.
   */
  static async canView(userId, tenant, bookingId, hasManagePermission) {
    const booking = await BookingManager.getBooking(bookingId, tenant);

    if (!booking) {
      return false;
    }

    return decide(booking, [], { userId, canManage: hasManagePermission })
      .canView;
  }

  /**
   * Returns all bookings of a user that grant any access authorization
   * i.e. that resolve to at least one door access point
   * (and, if requested, the compartments of a locker system).
   *
   * Tenant-independent: a user may have bookings across several tenants. The
   * user's committed bookings are loaded once (narrowed by status/time) and the
   * access point inheritance is resolved per tenant via a trigger map.
   *
   * @param {string} userId Assigned user ID
   * @param {Object} [opts]
   * @param {string} [opts.state="all"] One of "active" | "upcoming" | "past" | "all"
   * @param {string|null} [opts.capability=null] "authorization" to restrict to provisioned authorizations
   * @param {boolean} [opts.includeAccessPoints=false] Attach the full access point list per booking
   * @param {boolean} [opts.includeLockers=false] List the compartments of the
   *   booking's locker systems too, each under its own id
   * @param {boolean} [opts.includeBuffer=false] Honor the access buffer for state="active"
   * @param {boolean} [opts.includeEligibility=false] Attach per-booking access eligibility
   *   (implicitly honors access buffers for `state="active"` filtering and evaluation)
   * @param {number} [opts.now=Date.now()] Reference timestamp
   * @returns {Promise<Object[]>} Matching bookings (sensitive data stripped)
   */
  static async getUserBookingsWithAccess(
    userId,
    {
      state = "all",
      capability = null,
      includeAccessPoints = false,
      includeLockers = false,
      includeBuffer = false,
      includeEligibility = false,
      now = Date.now(),
    } = {},
  ) {
    const honorBuffer = includeBuffer || includeEligibility;
    const timeFilter = this._buildTimeFilter(state, now, honorBuffer);
    const bookings = await BookingManager.getUserBookingsFiltered(
      null,
      userId,
      {
        timeFilter,
        requireCommitted: !includeEligibility,
      },
    );

    if (!bookings.length) {
      return [];
    }

    const triggerMaps = await this._getAccessTriggerMapsForTenants(
      this._uniqueTenantIds(bookings),
    );

    const managePermissionByTenant =
      includeEligibility || includeAccessPoints
        ? await this._resolveManagePermissionByTenant(
            userId,
            this._uniqueTenantIds(bookings),
          )
        : null;

    return this._buildAccessBookingResults(bookings, {
      state,
      capability,
      includeAccessPoints,
      includeLockers,
      includeBuffer: honorBuffer,
      includeEligibility,
      userId,
      managePermissionByTenant,
      now,
      resolve: (booking) =>
        this._resolveBookingAccess(
          booking,
          triggerMaps.get(booking.tenantId) || new Map(),
          { capability, includeLockers },
        ),
    });
  }

  /**
   * Returns all bookings of a user that grant an access authorization for a
   * specific access point, resolved via the bookables. A door answers its own
   * id; a locker system answers, when `includeLockers` is set, the ids of
   * the booking's compartments at it.
   *
   * Tenant-independent: trigger ids for the access point are resolved per
   * tenant the user has bookings in.
   *
   * @param {string} userId Assigned user ID
   * @param {string} accessPointId Access point ID
   * @param {Object} [opts] See {@link getUserBookingsWithAccess}
   * @returns {Promise<Object[]>} Matching bookings (sensitive data stripped)
   */
  static async getUserBookingsForAccessPoint(
    userId,
    accessPointId,
    {
      state = "all",
      capability = null,
      includeAccessPoints = false,
      includeLockers = false,
      includeBuffer = false,
      includeEligibility = false,
      now = Date.now(),
    } = {},
  ) {
    const honorBuffer = includeBuffer || includeEligibility;
    const timeFilter = this._buildTimeFilter(state, now, honorBuffer);
    const bookings = await BookingManager.getUserBookingsFiltered(
      null,
      userId,
      {
        timeFilter,
        requireCommitted: !includeEligibility,
      },
    );

    if (!bookings.length) {
      return [];
    }

    const tenantIds = this._uniqueTenantIds(bookings);
    const triggerByTenant = new Map();
    await Promise.all(
      tenantIds.map(async (tenantId) => {
        triggerByTenant.set(
          tenantId,
          await this._getTriggerBookableIdsForAccessPoint(
            tenantId,
            accessPointId,
          ),
        );
      }),
    );

    return this._buildAccessBookingResults(bookings, {
      state,
      capability,
      includeAccessPoints,
      includeLockers,
      includeBuffer: honorBuffer,
      includeEligibility,
      userId,
      managePermissionByTenant:
        includeEligibility || includeAccessPoints
          ? await this._resolveManagePermissionByTenant(userId, tenantIds)
          : null,
      now,
      resolve: (booking) => {
        const { triggerIds, mode, type } = triggerByTenant.get(
          booking.tenantId,
        ) || { triggerIds: new Set(), mode: null, type: null };
        return this._resolveBookingAccessForPoint(
          booking,
          accessPointId,
          { mode, type },
          { triggerIds, capability, includeLockers },
        );
      },
    });
  }

  /**
   * @private
   * Builds one trigger map per tenant.
   * @returns {Promise<Map<string, Map<string, Map<string, string>>>>}
   */
  static async _getAccessTriggerMapsForTenants(tenantIds) {
    const entries = await Promise.all(
      tenantIds.map(async (tenantId) => [
        tenantId,
        await this._getAccessTriggerMap(tenantId),
      ]),
    );
    return new Map(entries);
  }

  /** @private */
  static _uniqueTenantIds(bookings) {
    return [...new Set(bookings.map((booking) => booking.tenantId))];
  }

  /**
   * @private
   * Shared post-processing: applies the per-booking access resolution, the
   * state/validity filter and (optionally) enriches with the full access point
   * list. Returns plain, sensitive-data-free result objects.
   */
  static async _buildAccessBookingResults(
    bookings,
    {
      state,
      capability,
      includeAccessPoints,
      includeLockers,
      includeBuffer,
      includeEligibility,
      userId,
      managePermissionByTenant,
      now,
      resolve,
    },
  ) {
    const matched = [];

    for (const booking of bookings) {
      if (!includeEligibility && !booking.isBookingValid()) {
        continue;
      }

      const resolved = resolve(booking);
      if (!resolved || !resolved.accessPointIds.length) {
        continue;
      }

      const needsEnrichment =
        includeAccessPoints ||
        (state === "active" && includeBuffer) ||
        includeEligibility;
      let entries = null;
      if (needsEnrichment) {
        entries = await this._getFilteredBookingAccessPointEntries(
          booking.tenantId,
          booking.id,
          { capability, includeLockers },
        );
      }

      if (
        !this._matchesState(
          booking,
          state,
          now,
          includeBuffer,
          entries,
          includeEligibility,
        )
      ) {
        continue;
      }

      const result = {
        id: booking.id,
        tenantId: booking.tenantId,
        assignedUserId: booking.assignedUserId,
        timeBegin: booking.timeBegin,
        timeEnd: booking.timeEnd,
        isCommitted: booking.isCommitted,
        isPayed: booking.isPayed,
        isRejected: booking.isRejected,
        priceEur: booking.priceEur,
        state: this._deriveState(booking, now),
        accessPointIds: resolved.accessPointIds,
      };

      // One decision per booking, whichever of the blocks below asks for it:
      // the projection reads from it what each door demands of this user, and
      // the eligibility the API hands out is the decision itself.
      const decision = decide(booking, entries || [], {
        userId,
        canManage: managePermissionByTenant?.get(booking.tenantId) ?? false,
        now,
      });

      if (includeAccessPoints) {
        result.accessPoints = (entries || []).map(
          ({ accessPoint, bookingContext }) =>
            projectAccessPoint(accessPoint, { decision, bookingContext }),
        );
      }

      if (includeEligibility) {
        result.accessEligibility = decision;
      }

      matched.push({ result, booking });
    }

    await this._attachLeadBookables(matched);

    const results = matched.map(({ result }) => result);

    return this._sortResults(results, state);
  }

  /**
   * @private
   * Attaches the `leadBookable` (id, title, location) of each booking's first
   * booked item to its result. Lead bookables are batch-loaded per tenant to
   * avoid N+1 queries.
   */
  static async _attachLeadBookables(matched) {
    const idsByTenant = new Map();
    for (const { booking } of matched) {
      const leadId = this._getLeadBookableId(booking);
      if (!leadId) {
        continue;
      }
      let ids = idsByTenant.get(booking.tenantId);
      if (!ids) {
        ids = new Set();
        idsByTenant.set(booking.tenantId, ids);
      }
      ids.add(leadId);
    }

    const bookableByKey = new Map();
    await Promise.all(
      [...idsByTenant.entries()].map(async ([tenantId, ids]) => {
        const bookables = await BookableManager.getBookablesByIds(tenantId, [
          ...ids,
        ]);
        for (const bookable of bookables) {
          bookableByKey.set(`${tenantId}:${bookable.id}`, bookable);
        }
      }),
    );

    for (const { result, booking } of matched) {
      const leadId = this._getLeadBookableId(booking);
      const bookable = leadId
        ? bookableByKey.get(`${booking.tenantId}:${leadId}`)
        : null;

      result.leadBookable = bookable
        ? {
            id: bookable.id,
            title: bookable.title,
            location: bookable.location,
          }
        : null;
    }
  }

  /**
   * @private
   * Returns the bookable id of the first item booked in a booking, or null.
   */
  static _getLeadBookableId(booking) {
    const firstItem = (booking.bookableItems || [])[0];
    if (!firstItem) {
      return null;
    }
    return firstItem.bookableId || firstItem._bookableUsed?.id || null;
  }

  /**
   * @private
   * Builds the trigger map for a tenant: a map from a directly bookable id to
   * the access points that a booking referencing it would inherit. The map
   * keys are exactly the bookable ids that confer an access authorization.
   *
   * Inheritance mirrors {@link _getBookableRelations} but inverted: for each
   * bookable X with active access points, a booking confers X's points if it
   * directly references X, an ancestor of X (when children are inherited) or a
   * descendant of X (when parents are inherited).
   *
   * @returns {Promise<Map<string, Map<string, { mode: string, type: string }>>>}
   *   bookableId -> (accessPointId -> the access point's mode and type)
   */
  static async _getAccessTriggerMap(tenant) {
    const apBookables =
      await BookableManager.getBookablesWithAccessPoints(tenant);

    const accessPointsById = await this._getAccessPointsById(
      tenant,
      apBookables,
    );

    const inheritChildren =
      process.env.ACCESS_POINTS_INHERIT_CHILDREN !== "false";
    const inheritParents =
      process.env.ACCESS_POINTS_INHERIT_PARENTS !== "false";

    const map = new Map();
    const addPoints = (bookableId, accessPointIds) => {
      let pointMap = map.get(bookableId);
      if (!pointMap) {
        pointMap = new Map();
        map.set(bookableId, pointMap);
      }
      for (const accessPointId of accessPointIds) {
        pointMap.set(
          accessPointId,
          this._accessPointKind(accessPointsById.get(accessPointId)),
        );
      }
    };

    await Promise.all(
      apBookables.map(async (bookable) => {
        // References without an access point confer nothing - they are doors
        // that no longer exist.
        const points = (
          bookable.accessPointDetails?.accessPointIds || []
        ).flatMap((accessPointId) =>
          accessPointsById.has(String(accessPointId))
            ? [String(accessPointId)]
            : [],
        );
        if (!points.length) {
          return;
        }

        addPoints(bookable.id, points);

        const relatedLookups = [];
        if (inheritChildren) {
          relatedLookups.push(
            BookableManager.getAllParentBookables(bookable.id, tenant),
          );
        }
        if (inheritParents) {
          relatedLookups.push(
            BookableManager.getRelatedBookables(bookable.id, tenant),
          );
        }

        const relatedGroups = await Promise.all(relatedLookups);
        for (const group of relatedGroups) {
          for (const related of group) {
            addPoints(related.id, points);
          }
        }
      }),
    );

    return map;
  }

  /**
   * @private
   * Resolves the set of directly bookable ids whose booking would confer the
   * given access point, plus the access point's mode and type.
   * @returns {Promise<{ triggerIds: Set<string>, mode: string|null,
   *   type: string|null }>}
   */
  static async _getTriggerBookableIdsForAccessPoint(tenant, accessPointId) {
    const apBookables = await BookableManager.getBookablesByAccessPointId(
      tenant,
      accessPointId,
    );

    const inheritChildren =
      process.env.ACCESS_POINTS_INHERIT_CHILDREN !== "false";
    const inheritParents =
      process.env.ACCESS_POINTS_INHERIT_PARENTS !== "false";

    const triggerIds = new Set();
    let mode = null;
    let type = null;

    if (apBookables.length > 0) {
      const accessPoint = await AccessPointManager.getAccessPoint(
        accessPointId,
        tenant,
      );
      if (accessPoint) {
        ({ mode, type } = this._accessPointKind(accessPoint));
      }
    }

    await Promise.all(
      apBookables.map(async (bookable) => {
        triggerIds.add(bookable.id);

        const relatedLookups = [];
        if (inheritChildren) {
          relatedLookups.push(
            BookableManager.getAllParentBookables(bookable.id, tenant),
          );
        }
        if (inheritParents) {
          relatedLookups.push(
            BookableManager.getRelatedBookables(bookable.id, tenant),
          );
        }

        const relatedGroups = await Promise.all(relatedLookups);
        for (const group of relatedGroups) {
          for (const related of group) {
            triggerIds.add(related.id);
          }
        }
      }),
    );

    return { triggerIds, mode, type };
  }

  /**
   * @private
   * What the list paths need to know of a stored access point: how it opens
   * and whether it is a door or a locker system. A stored access point
   * without a type is a door, without a mode one that takes a code.
   */
  static _accessPointKind(accessPoint) {
    return {
      mode: accessPoint.mode || AccessPointMode.AUTHORIZATION,
      type: accessPoint.type || AccessPointType.DOOR,
    };
  }

  /**
   * @private
   * Resolves which access point ids a booking confers, using the precomputed
   * trigger map: its doors, and with `includeLockers` the compartments of
   * its locker systems, each under its own id. Honors the `capability`
   * filter, which compartments never pass - they are no keypad code.
   */
  static _resolveBookingAccess(
    booking,
    triggerMap,
    { capability, includeLockers },
  ) {
    const directIds = this._getBookableIds(booking);
    const seen = new Set();
    const accessPointIds = [];

    for (const bookableId of directIds) {
      const pointMap = triggerMap.get(bookableId);
      if (!pointMap) {
        continue;
      }

      for (const [accessPointId, kind] of pointMap) {
        if (seen.has(accessPointId)) {
          continue;
        }
        seen.add(accessPointId);
        accessPointIds.push(
          ...this._conferredIds(booking, accessPointId, kind, {
            capability,
            includeLockers,
          }),
        );
      }
    }

    return { accessPointIds };
  }

  /**
   * @private
   * Resolves whether a booking confers a single, specific access point - a
   * door, or a locker system whose compartments are then answered.
   */
  static _resolveBookingAccessForPoint(
    booking,
    accessPointId,
    kind,
    { triggerIds, capability, includeLockers },
  ) {
    const directIds = this._getBookableIds(booking);
    const matchesBookable =
      triggerIds.size > 0 && directIds.some((id) => triggerIds.has(id));

    if (!matchesBookable) {
      return { accessPointIds: [] };
    }

    return {
      accessPointIds: this._conferredIds(booking, String(accessPointId), kind, {
        capability,
        includeLockers,
      }),
    };
  }

  /**
   * @private
   * The ids a booking confers at one access point it books: the door's own
   * id, or the ids of the booking's compartments at a locker system.
   *
   * @param {Object} booking The booking
   * @param {string} accessPointId The stored access point's id
   * @param {{ mode: string, type: string }} kind Its mode and type
   * @param {Object} filters `capability` and `includeLockers`
   * @returns {string[]} The conferred ids, empty where the filters keep the
   *   access point out
   */
  static _conferredIds(
    booking,
    accessPointId,
    { mode, type },
    { capability, includeLockers },
  ) {
    const onlyAuthorization = capability === "authorization";

    if (type === AccessPointType.LOCKER) {
      if (!includeLockers || onlyAuthorization) {
        return [];
      }
      return this._compartmentEntries(booking)
        .filter((entry) => String(entry.accessPointId) === accessPointId)
        .map((entry) => this._compartmentId(entry));
    }

    if (onlyAuthorization && !this._usesAuthorization(mode)) {
      return [];
    }

    return [accessPointId];
  }

  /**
   * @private
   * Loads the access point entries of a booking and applies the
   * capability/locker filters. Entries rather than the projection, because the
   * access decision needs fields a client never sees.
   *
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @param {Object} filters
   * @param {string|null} filters.capability `"authorization"` to keep only the
   *   access points a booking holds an authorization for
   * @param {boolean} filters.includeLockers Whether the compartments of the
   *   booking's locker systems are listed too
   * @returns {Promise<{ accessPoint: Object, bookingContext: Object }[]>} The
   *   entries that passed the filters
   */
  static async _getFilteredBookingAccessPointEntries(
    tenant,
    bookingId,
    { capability, includeLockers },
  ) {
    const entries = await this._getBookingAccessPointEntries(tenant, bookingId);
    const onlyAuthorization = capability === "authorization";

    return entries.filter(({ accessPoint }) => {
      if (accessPoint.type === AccessPointType.LOCKER) {
        return includeLockers && !onlyAuthorization;
      }
      if (onlyAuthorization) {
        return this._usesAuthorization(accessPoint.mode);
      }
      return true;
    });
  }

  /**
   * @private
   * Builds the database time filter for a state. Returns `{}` when the filter
   * cannot be safely expressed at the database level (active + buffer).
   */
  static _buildTimeFilter(state, now, includeBuffer) {
    switch (state) {
      case "active":
        if (includeBuffer) {
          return {};
        }
        return { timeBegin: { $lte: now }, timeEnd: { $gte: now } };
      case "upcoming":
        return { timeBegin: { $gt: now } };
      case "past":
        return { timeEnd: { $lt: now } };
      default:
        return {};
    }
  }

  /**
   * @private
   * In-memory state check (the database filter is only an optimization).
   */
  static _matchesState(
    booking,
    state,
    now,
    includeBuffer,
    entries,
    includeEligibility = false,
  ) {
    switch (state) {
      case "active":
        if (includeBuffer) {
          const { beforeMs, afterMs } = this._maxBuffer(entries);
          if (includeEligibility) {
            return this._isWithinBufferedTimeWindow(
              booking,
              beforeMs,
              afterMs,
              now,
            );
          }
          return booking.isWithinAccessWindow(beforeMs, afterMs, now);
        }
        return booking.timeBegin <= now && booking.timeEnd >= now;
      case "upcoming":
        return booking.timeBegin > now;
      case "past":
        return booking.timeEnd < now;
      default:
        return true;
    }
  }

  /**
   * @private
   * Largest access buffer across a booking's resolved door access points.
   */
  static _maxBuffer(entries) {
    let beforeMs = 0;
    let afterMs = 0;
    for (const { bookingContext } of entries || []) {
      const buffer = bookingContext?.accessBuffer || {};
      beforeMs = Math.max(beforeMs, buffer.beforeMs || 0);
      afterMs = Math.max(afterMs, buffer.afterMs || 0);
    }
    return { beforeMs, afterMs };
  }

  /**
   * @private
   * Whether `now` falls inside the booking time range extended by a buffer,
   * independent of booking validity (committed/paid/rejected).
   */
  static _isWithinBufferedTimeWindow(booking, beforeMs = 0, afterMs = 0, now) {
    return (
      booking.timeBegin - beforeMs <= now && booking.timeEnd + afterMs >= now
    );
  }

  /**
   * @private
   */
  static _deriveState(booking, now) {
    if (booking.timeBegin <= now && booking.timeEnd >= now) {
      return "active";
    }
    if (booking.timeBegin > now) {
      return "upcoming";
    }
    return "past";
  }

  /**
   * @private
   * Default sort: upcoming/active ascending by start, past descending.
   */
  static _sortResults(results, state) {
    const descending = state === "past";
    return results.sort((a, b) =>
      descending ? b.timeBegin - a.timeBegin : a.timeBegin - b.timeBegin,
    );
  }

  /**
   * @private
   * Resolves access point + builds booking context for the provider.
   *
   * An unresolvable target is forbidden rather than refused: neither a missing
   * booking nor an access point outside the booking is an access decision, so
   * there is no reason vocabulary and nothing to audit against.
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @param {string} accessPointId Access point ID
   * @returns {Promise<Object>} Access point, booking context and booking
   * @throws {ForbiddenError} The booking does not exist or does not include
   *   the access point.
   */
  static async _resolve(tenant, bookingId, accessPointId) {
    const resolved = await this._tryResolve(tenant, bookingId, accessPointId);

    if (!resolved) {
      throw new ForbiddenError("access_point_not_in_booking", {
        bookingId,
        accessPointId,
      });
    }

    return resolved;
  }

  /**
   * @private
   * Resolves one access point of a booking together with its booking.
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @param {string} accessPointId Access point ID
   * @returns {Promise<Object|null>} Access point, booking context and booking,
   *   or null when the booking does not exist or does not include the access
   *   point
   */
  static async _tryResolve(tenant, bookingId, accessPointId) {
    const booking = await BookingManager.getBooking(bookingId, tenant);

    if (!booking) {
      return null;
    }

    const { compartments, doors } =
      await this._getBookingAccessPointsFromBooking(tenant, booking);
    const resolved = [...compartments, ...doors].find(
      ({ accessPoint }) => String(accessPoint.id) === String(accessPointId),
    );

    return resolved ? { ...resolved, booking } : null;
  }

  static async _getBookingAccessPoints(tenant, bookingId) {
    const booking = await BookingManager.getBooking(bookingId, tenant);

    if (!booking) {
      throw new Error(`Booking ${bookingId} not found`);
    }

    return this._getBookingAccessPointsFromBooking(tenant, booking);
  }

  /**
   * @private
   * The access points of a booking as everything above the API boundary
   * works on them: its doors, one entry each, and the compartments of the
   * locker systems it books, one entry per compartment under the
   * compartment's own id. The locker systems themselves come along, keyed
   * by their row id, for the paths that write entries - hold, grant,
   * revoke.
   *
   * @param {string} tenant Tenant ID
   * @param {Object} booking The loaded booking
   * @returns {Promise<{ booking: Object, compartments: Object[],
   *   doors: Object[], lockerSystems: Map<string, Object> }>} The entries
   *   and the systems
   */
  static async _getBookingAccessPointsFromBooking(tenant, booking) {
    const sources = await this._loadAccessPointSources(tenant, booking);
    const doors = this._resolveDoors(tenant, booking, sources);
    const lockerSystems = this._resolveLockerSystems(tenant, booking, sources);
    const compartments = this._compartmentEntries(booking).flatMap((entry) => {
      const system = lockerSystems.get(String(entry.accessPointId));
      return system
        ? [
            {
              accessPoint: this._compartmentAccessPoint(system, entry),
              bookingContext: this._compartmentContext(
                tenant,
                booking,
                system,
                entry,
              ),
            },
          ]
        : [];
    });

    return { booking, compartments, doors, lockerSystems };
  }

  /**
   * @private
   * The `accessInfo` entries of the booking's compartments, in their stored
   * order. Entries are written in place, so the caller mutates what it gets.
   *
   * @param {Object} booking The booking
   * @returns {Object[]} The entries of type `locker`
   */
  static _compartmentEntries(booking) {
    return (booking.accessInfo || []).filter(
      (entry) => entry.accessPointType === AccessPointType.LOCKER,
    );
  }

  /**
   * @private
   * The opaque id a compartment is operated by: the locker system's row and
   * the grant, or `hold` before the grant.
   *
   * @param {Object} entry The compartment's `accessInfo` entry
   * @returns {string} `<accessPointId>:<authorizationId>` or
   *   `<accessPointId>:hold`
   */
  static _compartmentId(entry) {
    return `${entry.accessPointId}:${entry.grant?.authorizationId ?? "hold"}`;
  }

  /**
   * @private
   * The compartment as an access point: the locker system's row under the
   * compartment's own id. What a provider reads - `tenantId`, `externalId`,
   * `provider` - is the row's; what the decision and the projection read -
   * `id`, `type`, `mode`, `validationRules` - names the compartment.
   */
  static _compartmentAccessPoint(system, entry) {
    return { ...system.accessPoint, id: this._compartmentId(entry) };
  }

  /**
   * @private
   * The booking context of one compartment: the booking's window with the
   * buffer of the bookable, and the compartment's own state - the hold to
   * consume, the grant, the compartment the provider named.
   */
  static _compartmentContext(tenant, booking, system, entry) {
    const { beforeMs, afterMs } = system.bookable
      ? this._resolveAccessBuffer(system.bookable)
      : { beforeMs: 0, afterMs: 0 };

    return {
      tenant,
      bookingId: booking.id,
      timeBegin: booking.timeBegin,
      timeEnd: booking.timeEnd,
      accessBuffer: { beforeMs, afterMs },
      accessFrom: booking.timeBegin - beforeMs,
      accessTo: booking.timeEnd + afterMs,
      booking,
      hold: entry.hold || null,
      compartment: entry.compartment ?? null,
      externalBookingId: entry.grant?.authorizationId ?? null,
      grant: entry.grant || null,
      // Provisioned is the grant, not the existence: granted and not revoked.
      isProvisioned: Boolean(entry.grant?.authorizationId) && !entry.revokedAt,
      provisionedAt: entry.provisionedAt || null,
      revokedAt: entry.revokedAt || null,
      principalRemovedAt: entry.principalRemovedAt || null,
      lastEvent: entry.lastEvent || null,
    };
  }

  /**
   * @private
   * Makes the entries of the compartments the booking is owed: as many
   * per locker system as the bookable's item books, minus those there
   * already and not revoked. Where new ones are needed the revoked entries
   * of that system make way for them - a fresh grant starts the
   * compartments of a system over, as it does a door's entry - while a
   * system whose compartments are all revoked and none needed keeps them
   * as the record of the revoke.
   *
   * @param {Object} booking The booking, written into
   * @param {Map<string, Object>} lockerSystems The systems and how many
   *   compartments each is owed
   */
  static _ensureCompartmentEntries(booking, lockerSystems) {
    if (!Array.isArray(booking.accessInfo)) {
      booking.accessInfo = [];
    }

    for (const [accessPointId, system] of lockerSystems) {
      const atSystem = (entry) =>
        entry.accessPointType === AccessPointType.LOCKER &&
        String(entry.accessPointId) === accessPointId;
      const active = booking.accessInfo.filter(
        (entry) => atSystem(entry) && !entry.revokedAt,
      );
      const missing = system.amount - active.length;

      if (missing <= 0) {
        continue;
      }

      booking.accessInfo = booking.accessInfo.filter(
        (entry) => !atSystem(entry) || !entry.revokedAt,
      );
      for (let i = 0; i < missing; i += 1) {
        booking.accessInfo.push({
          accessPointId: system.accessPoint.id,
          accessPointType: AccessPointType.LOCKER,
          provider: system.accessPoint.provider,
          externalId: system.accessPoint.externalId,
          mode: system.accessPoint.mode,
          bookableId: system.bookable?.id ?? null,
          hold: null,
          compartment: null,
          metadata: null,
          externalBookingId: null,
          isProvisioned: false,
          provisionedAt: null,
          revokedAt: null,
          grant: null,
        });
      }
    }
  }

  /**
   * @private
   * Drops the entries only held - not granted, not revoked - beyond what
   * the booking books now: at a locker system it no longer books, or past
   * the amount its item books, the granted ones counted first. What the
   * provider holds for them lapses by itself.
   *
   * @param {Object} booking The booking, written into
   * @param {Map<string, Object>} lockerSystems The systems and how many
   *   compartments each is owed
   */
  static _trimHeldCompartments(booking, lockerSystems) {
    if (!Array.isArray(booking.accessInfo)) {
      return;
    }

    const compartments = this._compartmentEntries(booking);
    const allowance = new Map();
    for (const [accessPointId, system] of lockerSystems) {
      const granted = compartments.filter(
        (entry) =>
          String(entry.accessPointId) === accessPointId &&
          entry.grant &&
          !entry.revokedAt,
      ).length;
      allowance.set(accessPointId, Math.max(system.amount - granted, 0));
    }

    booking.accessInfo = booking.accessInfo.filter((entry) => {
      if (
        entry.accessPointType !== AccessPointType.LOCKER ||
        entry.grant ||
        entry.revokedAt
      ) {
        return true;
      }
      const key = String(entry.accessPointId);
      const left = allowance.get(key) ?? 0;
      allowance.set(key, left - 1);
      return left > 0;
    });
  }

  /**
   * @private
   * The hold as `accessInfo` stores it - the three fields of the provider's
   * Hold, nothing else.
   */
  static _toStoredHold(hold) {
    return {
      holdId: hold.holdId ?? null,
      expiresAt: hold.expiresAt ?? null,
      compartment: hold.compartment ?? null,
    };
  }

  /**
   * @private
   * Fails where the bookable has fewer compartments than the bookings in
   * this booking's window take, this booking included. The occupancy is
   * counted off the bookings' items, which is what `bookable.amount` is the
   * capacity of. At a locker system still configured at the bookable (see
   * {@link _addConfiguredLockerSystems}) the unit's amount is the capacity
   * and the occupancy is the compartments the bookings hold or have at
   * that system - those of bookings stored before the fold count only once
   * the migration has made entries of them.
   *
   * @param {string} tenant Tenant ID
   * @param {Object} booking The booking that holds
   * @param {{ accessPoint: Object, bookable: Object }} system The locker
   *   system held at, with the bookable that books it
   * @throws {ConflictError} `compartments_unavailable`
   */
  static async _assertCompartmentCapacity(tenant, booking, system) {
    const { accessPoint, bookable } = system;
    const configured = Number.isFinite(accessPoint.capacity);
    const capacity = configured
      ? accessPoint.capacity
      : Number(bookable.amount);
    if (!Number.isFinite(capacity)) {
      return;
    }

    const others = await BookingManager.getConcurrentBookings(
      bookable.id,
      tenant,
      booking.timeBegin,
      booking.timeEnd,
      booking.id,
    );
    const occupied = [...others, booking].reduce(
      (sum, concurrent) =>
        sum +
        (configured
          ? this._activeCompartmentsAt(concurrent, accessPoint)
          : this._itemAmount(concurrent, bookable.id)),
      0,
    );

    if (occupied > capacity) {
      throw new ConflictError("compartments_unavailable", {
        bookableId: bookable.id,
        capacity,
        occupied,
      });
    }
  }

  /**
   * @private
   * How many compartments a booking holds or has at a locker system: its
   * unrevoked entries there, whether made at the system's row or at the
   * synthesized one of the same provider and external id.
   */
  static _activeCompartmentsAt(booking, accessPoint) {
    return this._compartmentEntries(booking).filter(
      (entry) =>
        !entry.revokedAt &&
        (String(entry.accessPointId) === String(accessPoint.id) ||
          (entry.provider === accessPoint.provider &&
            String(entry.externalId) === String(accessPoint.externalId))),
    ).length;
  }

  /**
   * @private
   * How many of a bookable a booking books, over all of its items.
   */
  static _itemAmount(booking, bookableId) {
    return (booking.bookableItems || [])
      .filter(
        (item) => (item.bookableId || item._bookableUsed?.id) === bookableId,
      )
      .reduce((sum, item) => sum + (Number(item.amount) || 1), 0);
  }

  /**
   * @private
   * The stored access points of a booking with the bookables they are
   * reached through, loaded once for doors and locker systems alike: the
   * bookables of the booking with their relations, and every access point
   * they reference - plus those the booking's compartments were made at,
   * so that a compartment can still be revoked where the bookable dropped
   * its locker system since.
   */
  static async _loadAccessPointSources(tenant, booking) {
    const bookableRelations = await this._getBookableRelations(tenant, booking);
    const bookables = await BookableManager.getBookablesByIds(tenant, [
      ...bookableRelations.keys(),
    ]);
    const sortedBookables = this._sortBookablesByRelation(
      bookables,
      bookableRelations,
    );
    const accessPointsById = await this._getAccessPointsById(
      tenant,
      sortedBookables,
      this._compartmentEntries(booking).map((entry) =>
        String(entry.accessPointId),
      ),
    );
    const configuredLockerSystemIds = await this._addConfiguredLockerSystems(
      tenant,
      sortedBookables,
      booking,
      accessPointsById,
    );

    return {
      bookableRelations,
      sortedBookables,
      accessPointsById,
      configuredLockerSystemIds,
    };
  }

  /**
   * @private
   * Stands in for the rows of the locker systems still configured at the
   * bookables as `lockerDetails.units`, until the migration of the locker
   * fold moves them into `accesspoints`: one synthesized row per unit whose
   * provider the tenant has an active application for, under the id
   * `locker:<provider>:<externalId>`, with the unit's amount as `capacity`
   * for the platform hold. A bookable that references a stored locker
   * system already is left to its rows. A compartment entry left at a
   * synthesized id after the bookable dropped the unit is resolved from
   * the entry itself, so it can still be revoked.
   *
   * @param {string} tenant Tenant ID
   * @param {Object[]} bookables The bookables of the booking
   * @param {Object} booking The booking
   * @param {Map<string, Object>} accessPointsById The loaded rows, written
   *   into
   * @returns {Promise<Map<string, string[]>>} bookableId -> the ids of the
   *   locker systems synthesized for it
   */
  static async _addConfiguredLockerSystems(
    tenant,
    bookables,
    booking,
    accessPointsById,
  ) {
    const configured = new Map();
    const units = bookables.flatMap((bookable) =>
      this._bookableReferencesLockerSystem(bookable, accessPointsById) ||
      bookable.lockerDetails?.active !== true
        ? []
        : (bookable.lockerDetails.units || []).map((unit) => ({
            bookable,
            unit,
          })),
    );
    const orphaned = this._compartmentEntries(booking).filter(
      (entry) =>
        String(entry.accessPointId).startsWith(
          CONFIGURED_LOCKER_SYSTEM_PREFIX,
        ) && !accessPointsById.has(String(entry.accessPointId)),
    );

    if (!units.length && !orphaned.length) {
      return configured;
    }

    const tenantData = units.length
      ? await TenantManager.getTenant(tenant)
      : null;

    for (const { bookable, unit } of units) {
      const provider = unit.lockerSystem;
      const externalId = provider === IFBS ? unit.locationId : unit.id;
      if (
        !provider ||
        externalId == null ||
        !this._hasActiveApplication(tenantData, provider)
      ) {
        continue;
      }

      const id = `${CONFIGURED_LOCKER_SYSTEM_PREFIX}${provider}:${externalId}`;
      if (!accessPointsById.has(id)) {
        accessPointsById.set(id, {
          ...this._configuredLockerSystemRow(tenant, id, provider, externalId),
          label: bookable.title || "",
          mode:
            provider === IFBS
              ? AccessPointMode.REMOTE
              : AccessPointMode.AUTHORIZATION,
          capacity: Number(unit.amount),
        });
      }
      const ids = configured.get(bookable.id) || [];
      if (!ids.includes(id)) {
        ids.push(id);
      }
      configured.set(bookable.id, ids);
    }

    for (const entry of orphaned) {
      const id = String(entry.accessPointId);
      if (!accessPointsById.has(id)) {
        accessPointsById.set(id, {
          ...this._configuredLockerSystemRow(
            tenant,
            id,
            entry.provider,
            entry.externalId,
          ),
          mode: entry.mode || AccessPointMode.AUTHORIZATION,
        });
      }
    }

    return configured;
  }

  /**
   * @private
   * The row of a locker system configured at the bookable, as far as the
   * unit says: what the providers and the resolver read off a stored one.
   */
  static _configuredLockerSystemRow(tenant, id, provider, externalId) {
    return {
      id,
      tenantId: tenant,
      type: AccessPointType.LOCKER,
      provider,
      externalId: String(externalId),
      label: "",
      validationRules: [],
    };
  }

  /**
   * @private
   * Whether a bookable references a stored locker system - one configured
   * the new way, whose `lockerDetails` are then not the truth any more.
   */
  static _bookableReferencesLockerSystem(bookable, accessPointsById) {
    if (bookable.accessPointDetails?.active !== true) {
      return false;
    }

    return (bookable.accessPointDetails.accessPointIds || []).some((id) => {
      const accessPoint = accessPointsById.get(String(id));
      return (
        accessPoint &&
        this._accessPointKind(accessPoint).type === AccessPointType.LOCKER
      );
    });
  }

  /**
   * @private
   * Whether the tenant has an active application of the provider, under
   * the application types a locker provider's adapter looks under.
   */
  static _hasActiveApplication(tenantData, providerId) {
    return Boolean(
      AccessProvider.findActiveApplication(
        tenantData,
        providerId,
        AccessProvider.lockerApplicationTypes,
      ),
    );
  }

  /**
   * @private
   * The locker systems a booking books, keyed by row id: the row as the
   * compartments are resolved at it, the bookable that books it and how
   * many compartments that bookable's item books. Only the bookables
   * booked themselves count - a compartment is exclusive to its booking
   * and nothing a parent or child bookable confers. Systems the booking
   * holds compartments at without booking them any more come along with
   * nothing owed, for the revoke.
   *
   * @returns {Map<string, { accessPoint: Object, bookable: Object|null,
   *   amount: number }>}
   */
  static _resolveLockerSystems(tenant, booking, sources) {
    const {
      bookableRelations,
      sortedBookables,
      accessPointsById,
      configuredLockerSystemIds,
    } = sources;
    const systems = new Map();

    for (const bookable of sortedBookables) {
      if ((bookableRelations.get(bookable.id) || "self") !== "self") {
        continue;
      }

      const referenced =
        bookable.accessPointDetails?.active === true
          ? bookable.accessPointDetails.accessPointIds || []
          : [];
      const configured = configuredLockerSystemIds?.get(bookable.id) || [];

      for (const accessPointId of [...referenced, ...configured]) {
        const key = String(accessPointId);
        const accessPoint = accessPointsById.get(key);
        if (
          !accessPoint ||
          this._accessPointKind(accessPoint).type !== AccessPointType.LOCKER ||
          systems.has(key)
        ) {
          continue;
        }

        systems.set(key, {
          accessPoint: this._resolvedAccessPoint(tenant, accessPoint, bookable),
          bookable,
          amount: this._itemAmount(booking, bookable.id),
        });
      }
    }

    for (const entry of this._compartmentEntries(booking)) {
      const key = String(entry.accessPointId);
      const accessPoint = accessPointsById.get(key);
      if (
        accessPoint &&
        this._accessPointKind(accessPoint).type === AccessPointType.LOCKER &&
        !systems.has(key)
      ) {
        systems.set(key, {
          accessPoint: this._resolvedAccessPoint(tenant, accessPoint, null),
          bookable: null,
          amount: 0,
        });
      }
    }

    return systems;
  }

  /**
   * @private
   * The stored access point as the resolver hands it over - its rules and
   * the scan code they are checked against included, so the evidence step
   * judges by this one read and nothing reads the access point again. None
   * of it reaches a client: the projection is the boundary that keeps the
   * scan codes in. One stored without rules has none (`[]`); one stored
   * without a type is a door.
   */
  static _resolvedAccessPoint(
    tenant,
    accessPoint,
    bookable,
    relation = "self",
  ) {
    return {
      ...accessPoint,
      ...this._accessPointKind(accessPoint),
      tenantId: tenant,
      label: accessPoint.label || "",
      validationRules: accessPoint.validationRules || [],
      bookableId: bookable?.id ?? null,
      bookableTitle: bookable?.title ?? "",
      relation,
    };
  }

  /**
   * @private
   * Resolves the access buffer (lead/lag time around a booking) of a bookable.
   * The buffer is configured once per bookable
   * (`accessPointDetails.accessBuffer`) and applies to all of its access
   * points. Falls back to no buffer.
   * @returns {{ beforeMs: number, afterMs: number }}
   */
  static _resolveAccessBuffer(bookable) {
    const buffer = bookable.accessPointDetails?.accessBuffer || {};

    const before = Number(buffer.before ?? 0);
    const after = Number(buffer.after ?? 0);

    const toMs = (minutes) =>
      Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : 0;

    return { beforeMs: toMs(before), afterMs: toMs(after) };
  }

  /**
   * @private
   * Loads the access points the given bookables reference from the
   * `accesspoints` collection. Ids without an access point are left out - the
   * bookable is then simply not a door the booking can open.
   * @param {string} tenant Tenant ID
   * @param {Bookable[]} bookables The bookables whose references to resolve
   * @param {string[]} [extraIds=[]] Ids to load on top of the references
   * @returns {Promise<Map<string, AccessPoint>>} accessPointId -> access point
   */
  static async _getAccessPointsById(tenant, bookables, extraIds = []) {
    const accessPointIds = [
      ...new Set([
        ...bookables.flatMap((bookable) =>
          (bookable.accessPointDetails?.accessPointIds || []).map(String),
        ),
        ...extraIds,
      ]),
    ];
    const accessPoints = await AccessPointManager.getAccessPointsByIds(
      tenant,
      accessPointIds,
    );

    return new Map(
      accessPoints.map((accessPoint) => [String(accessPoint.id), accessPoint]),
    );
  }

  /**
   * @private
   * The doors among the loaded access points: every door the booked
   * bookables and their relations reference, once each, paired with what
   * the booking's `accessInfo` holds for it.
   */
  static _resolveDoors(tenant, booking, sources) {
    const { bookableRelations, sortedBookables, accessPointsById } = sources;
    const seenAccessPointIds = new Set();

    return sortedBookables.flatMap((bookable) => {
      if (bookable.accessPointDetails?.active !== true) {
        return [];
      }

      const { beforeMs, afterMs } = this._resolveAccessBuffer(bookable);

      return (bookable.accessPointDetails.accessPointIds || []).flatMap(
        (accessPointId) => {
          const accessPointKey = String(accessPointId);
          const accessPoint = accessPointsById.get(accessPointKey);

          if (
            !accessPoint ||
            this._accessPointKind(accessPoint).type !== AccessPointType.DOOR ||
            seenAccessPointIds.has(accessPointKey)
          ) {
            return [];
          }
          seenAccessPointIds.add(accessPointKey);

          const accessInfo = (booking.accessInfo || []).find(
            (info) => String(info.accessPointId) === accessPointKey,
          );

          return [
            {
              accessPoint: this._resolvedAccessPoint(
                tenant,
                accessPoint,
                bookable,
                bookableRelations.get(bookable.id) || "self",
              ),
              bookingContext: {
                tenant,
                bookingId: booking.id,
                timeBegin: booking.timeBegin,
                timeEnd: booking.timeEnd,
                accessBuffer: { beforeMs, afterMs },
                accessFrom: booking.timeBegin - beforeMs,
                accessTo: booking.timeEnd + afterMs,
                booking,
                grant: accessInfo?.grant || null,
                isProvisioned: accessInfo?.isProvisioned || false,
                provisionedAt: accessInfo?.provisionedAt || null,
                revokedAt: accessInfo?.revokedAt || null,
                principalRemovedAt: accessInfo?.principalRemovedAt || null,
                lastEvent: accessInfo?.lastEvent || null,
              },
            },
          ];
        },
      );
    });
  }

  static _getBookableIds(booking) {
    return [
      ...new Set(
        (booking.bookableItems || [])
          .map((item) => item.bookableId || item._bookableUsed?.id)
          .filter(Boolean),
      ),
    ];
  }

  static async _getBookableRelations(tenant, booking) {
    const directBookableIds = this._getBookableIds(booking);
    const bookableRelations = new Map();

    for (const bookableId of directBookableIds) {
      this._setBookableRelation(bookableRelations, bookableId, "self");
    }

    const inheritChildren =
      process.env.ACCESS_POINTS_INHERIT_CHILDREN !== "false";
    const inheritParents =
      process.env.ACCESS_POINTS_INHERIT_PARENTS !== "false";

    await Promise.all(
      directBookableIds.map(async (bookableId) => {
        if (inheritChildren) {
          const childBookables = await BookableManager.getRelatedBookables(
            bookableId,
            tenant,
          );

          for (const childBookable of childBookables) {
            this._setBookableRelation(
              bookableRelations,
              childBookable.id,
              "child",
            );
          }
        }

        if (inheritParents) {
          const parentBookables = await BookableManager.getAllParentBookables(
            bookableId,
            tenant,
          );

          for (const parentBookable of parentBookables) {
            this._setBookableRelation(
              bookableRelations,
              parentBookable.id,
              "parent",
            );
          }
        }
      }),
    );

    return bookableRelations;
  }

  static _setBookableRelation(bookableRelations, bookableId, relation) {
    const relationPriority = { self: 0, parent: 1, child: 2 };
    const currentRelation = bookableRelations.get(bookableId);

    if (
      !currentRelation ||
      relationPriority[relation] < relationPriority[currentRelation]
    ) {
      bookableRelations.set(bookableId, relation);
    }
  }

  static _sortBookablesByRelation(bookables, bookableRelations) {
    const relationPriority = { self: 0, parent: 1, child: 2 };

    return [...bookables].sort((a, b) => {
      const relationA = bookableRelations.get(a.id) || "self";
      const relationB = bookableRelations.get(b.id) || "self";

      return relationPriority[relationA] - relationPriority[relationB];
    });
  }

  static _usesAuthorization(mode) {
    return (
      mode === AccessPointMode.AUTHORIZATION || mode === AccessPointMode.BOTH
    );
  }

  static async _resolveManagePermissionByTenant(userId, tenantIds) {
    const entries = await Promise.all(
      tenantIds.map(async (tenantId) => [
        tenantId,
        await PermissionsService._allowUpdateAny(
          userId,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        ),
      ]),
    );
    return new Map(entries);
  }

  static async _getSupportedModes(provider, accessPoint, tenant) {
    if (!provider.constructor.capabilities.includes("getSupportedModes")) {
      return null;
    }

    return provider.getSupportedModes(accessPoint, tenant);
  }

  /**
   * Writes the entry of a door into the booking's `accessInfo`, merging into
   * the one already there - a door has one entry, keyed by `accessPointId`.
   * The schema keeps the entries free (`[Object]`); this is their shape:
   *
   *   accessPointId, accessPointType, provider, externalId, mode
   *   isProvisioned, provisionedAt, revokedAt
   *   grant: { authorizationId, externalPrincipalId, secret } | null
   *     - the Grant as the provider answered it, `secret` encrypted
   *   principalRemovedAt, principalCleanupAttemptedAt, principalCleanupError
   *     - what became of the grant's external principal after the revoke;
   *       the cleanup job works on these
   *   lastEvent - the last webhook event at this lock
   *
   * A compartment of a locker system (`accessPointType: locker`) has one
   * entry per compartment at the system's `accessPointId`, told apart by
   * `grant.authorizationId`, and is written in place rather than through
   * here. On top of the fields above it carries:
   *
   *   bookableId - the bookable whose item books the compartment
   *   hold: { holdId, expiresAt, compartment } | null
   *     - the claim before the grant; `null` once granted or revoked
   *   compartment - the compartment the provider named (iFBS' box number)
   *   externalBookingId - `grant.authorizationId`, for the projection
   *
   * @param {Object} booking The booking to write into
   * @param {Object} accessPoint The access point the entry is for
   * @param {Object} updates The fields to set
   */
  static _upsertAccessInfo(booking, accessPoint, updates) {
    if (!Array.isArray(booking.accessInfo)) {
      booking.accessInfo = [];
    }

    const index = booking.accessInfo.findIndex(
      (info) => String(info.accessPointId) === String(accessPoint.id),
    );
    const existing = index >= 0 ? booking.accessInfo[index] : {};
    const next = {
      ...existing,
      accessPointId: accessPoint.id,
      accessPointType: accessPoint.type,
      provider: accessPoint.provider,
      externalId: accessPoint.externalId,
      mode: accessPoint.mode,
      ...updates,
    };

    if (index >= 0) {
      booking.accessInfo[index] = next;
    } else {
      booking.accessInfo.push(next);
    }
  }

  /**
   * The grant as `accessInfo` stores it: the secret encrypted, so that the
   * booking never carries the PIN in clear.
   *
   * @param {import("./providers/access-provider").Grant} grant
   * @returns {Object}
   */
  static _toStoredGrant(grant) {
    return {
      authorizationId: grant.authorizationId,
      externalPrincipalId: grant.externalPrincipalId ?? null,
      secret: grant.secret ? SecurityUtils.encrypt(grant.secret) : null,
    };
  }

  /**
   * The grant as it goes back to the provider for a revoke: the handle and
   * the principal, and no secret - a revoke never needs it.
   *
   * @param {Object} storedGrant The grant as `accessInfo` holds it
   * @returns {import("./providers/access-provider").Grant}
   */
  static _toProviderGrant(storedGrant) {
    return {
      authorizationId: storedGrant.authorizationId,
      externalPrincipalId: storedGrant.externalPrincipalId ?? null,
      secret: null,
    };
  }

  /**
   * The grant as the audit log records it: never the secret, encrypted or
   * not.
   *
   * @param {Object} grant A grant, answered or stored
   * @returns {{ authorizationId: string, externalPrincipalId: string|null }}
   */
  static _toAuditedGrant(grant) {
    return {
      authorizationId: grant.authorizationId,
      externalPrincipalId: grant.externalPrincipalId ?? null,
    };
  }

  /**
   * @private
   * What makes the doors of a booking the same or not: which doors, at
   * which provider, opening how.
   */
  static _doorKey(doors) {
    return doors
      .map(({ accessPoint }) =>
        [
          accessPoint.id,
          accessPoint.provider,
          accessPoint.externalId,
          accessPoint.mode,
        ].join(":"),
      )
      .sort()
      .join("|");
  }

  /**
   * @private
   * What makes the allocation of compartments the same or not: which locker
   * systems, and how many compartments at each.
   */
  static _compartmentKey(lockerSystems) {
    return [...(lockerSystems || new Map()).entries()]
      .filter(([, system]) => system.amount > 0)
      .map(([accessPointId, system]) => `${accessPointId}:${system.amount}`)
      .sort()
      .join("|");
  }

  static async _sendProvisionedMail(booking, provisionedAccessPoints) {
    if (!provisionedAccessPoints.length || !booking.mail) {
      return;
    }

    try {
      await MailController.sendAccessProvisioned(
        booking.mail,
        booking.id,
        booking.tenantId,
        provisionedAccessPoints,
      );
    } catch (err) {
      logger.error(
        `${booking.tenantId} -- failed to send access provisioned mail for booking ${booking.id}: ${err.message}`,
      );
    }
  }

  /** @private */
  static async _log({
    tenantId,
    userId,
    accessPoint,
    bookingId,
    action,
    result = "pending",
    blockingReasons = [],
    payload = {},
    errorMessage = null,
    actor = null,
    channel = null,
    accessRole = null,
    evidenceBypassed = false,
  }) {
    logger.info(
      `${tenantId} -- ${action} ${result} on access-point ${accessPoint.id} (booking ${bookingId})`,
    );

    try {
      await AccessLogService.log({
        tenantId,
        bookingId,
        accessPointId: accessPoint.id,
        accessPointType: accessPoint.type,
        provider: accessPoint.provider,
        externalId: accessPoint.externalId || null,
        action,
        actor: actor || { userId, source: userId ? "user" : "system" },
        result,
        blockingReasons,
        channel,
        accessRole,
        evidenceBypassed,
        payload,
        errorMessage,
      });
    } catch (err) {
      logger.error(`Failed to write access log: ${err.message}`);
    }
  }
}

module.exports = AccessService;
