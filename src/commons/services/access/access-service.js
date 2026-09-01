const bunyan = require("bunyan");
const { getAccessProvider } = require("./providers/access-provider-registry");
const BookingManager = require("../../data-managers/booking-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");
const AccessPointManager = require("../../data-managers/access-point-manager");
const PermissionsService = require("../permission-service");
const SecurityUtils = require("../../utilities/security-utils");
const AccessLogService = require("./access-log-service");
const AccessEvidenceService = require("./access-evidence-service");
const { projectAccessPoint } = require("./access-point-projection");
const { AccessPointMode } = require("../../entities/access/access-point");
const { RolePermission } = require("../../entities/role/role");
const MailController = require("../../mail-service/mail-controller");
const { ForbiddenError } = require("../../../errors/BaseError");
const {
  ACCESS_BLOCKING_REASONS,
  prioritizeBlockingReasons,
} = require("./access-blocking-reasons");

const logger = bunyan.createLogger({
  name: "access-service.js",
  level: process.env.LOG_LEVEL,
});

class AccessService {
  /**
   * Opens an access point linked to a booking.
   *
   * Owns the eligibility decision, in two layers: the booking checks
   * (committed, paid, in window, ownership) apply to everyone, and on top of
   * them the access point's own validation rules demand evidence that the
   * person is really at the door. A refused attempt is audited
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
   * Behind the same guard as {@link open} - eligibility and evidence - because
   * it opens the same door. Where a lock can pull its latch, `open` does so by
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
   * The guarded way through a door: eligibility, then evidence, then the
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
    const { accessPoint, bookingContext } = resolved;
    const channel = options.channel ?? null;

    const eligibility = this._evaluateResolvedEligibility(resolved, {
      userId,
      hasManagePermission: options.hasManagePermission === true,
    });

    if (!eligibility.operableAccessPointIds.includes(String(accessPointId))) {
      return this._denyOpen({
        action,
        tenant,
        userId,
        accessPoint,
        bookingId,
        blockingReasons: eligibility.blockingReasons,
        channel,
        accessRole: eligibility.accessRole,
      });
    }

    const evidenceOutcome = await this._evaluateEvidence(tenant, accessPoint, {
      evidence: options.evidence,
      bypass: eligibility.accessRole === "manager",
    });

    if (!evidenceOutcome.satisfied) {
      return this._denyOpen({
        action,
        tenant,
        userId,
        accessPoint,
        bookingId,
        blockingReasons: evidenceOutcome.blockingReasons,
        channel,
        accessRole: eligibility.accessRole,
      });
    }

    try {
      const provider = getAccessProvider(accessPoint.provider);
      const result = await provider[action](accessPoint, bookingContext);

      await this._log({
        tenantId: tenant,
        userId,
        accessPoint,
        bookingId,
        action,
        result: "success",
        payload: {
          ...result,
          validatedEvidence: evidenceOutcome.validatedEvidence,
        },
        channel,
        accessRole: eligibility.accessRole,
        evidenceBypassed: evidenceOutcome.bypassed,
      });
      return {
        success: true,
        data: { openProcessId: this._toOpenProcessId(result) },
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
        accessRole: eligibility.accessRole,
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
   * @private
   * Checks the evidence requirements of the access point being opened.
   *
   * The requirements live on the stored access point, which is read again here:
   * the copy resolved through the bookable deliberately carries neither the
   * rules nor the scan code they are checked against.
   *
   * Lockers are not entities of the `accesspoints` collection and have no rules
   * to carry. A door that has one, on the other hand, must be readable - if it
   * disappeared while this request was running, what it demanded is unknown and
   * the attempt fails closed rather than opening a door whose rules nobody can
   * see.
   *
   * @param {string} tenant Tenant ID
   * @param {Object} accessPoint The resolved access point being opened
   * @param {Object} opts
   * @param {Object[]} [opts.evidence] Evidence the client sent
   * @param {boolean} opts.bypass Whether the user may skip the rules
   * @returns {Promise<Object>} Outcome as of {@link AccessEvidenceService.evaluate}
   */
  static async _evaluateEvidence(tenant, accessPoint, { evidence, bypass }) {
    if (accessPoint.type === "locker") {
      return AccessEvidenceService.evaluate(null, evidence, { bypass });
    }

    const storedAccessPoint = await AccessPointManager.getAccessPoint(
      accessPoint.id,
      tenant,
    );

    if (!storedAccessPoint) {
      logger.warn(
        `${tenant} -- access point ${accessPoint.id} vanished while it was being opened, failing closed`,
      );
      return AccessEvidenceService.ruleUnavailable();
    }

    return AccessEvidenceService.evaluate(storedAccessPoint, evidence, {
      bypass,
    });
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
      const result = await provider.close(accessPoint, bookingContext);

      await this._log({
        tenantId: tenant,
        userId,
        accessPoint,
        bookingId,
        action: "close",
        result: "success",
        payload: result,
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
        await provider.getStatus(accessPoint, bookingContext),
        "provider_status",
      );
    } catch (err) {
      logger.warn(
        `Could not read access point ${accessPoint.id} after closing it: ${err.message}`,
      );
      return this._toStatusResponse({}, null);
    }
  }

  /**
   * Returns the state of an open attempt: the running process where there is
   * one, the last event the door reported otherwise, and the lock's own state
   * as the last resort. `statusSource` says which of the three answered.
   *
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @param {string} accessPointId Access point ID
   * @param {string|null} openProcessId The process an open answered with
   * @returns {Promise<Object>} The status of the open attempt
   */
  static async getOpenStatus(tenant, bookingId, accessPointId, openProcessId) {
    const { accessPoint, bookingContext } = await this._resolve(
      tenant,
      bookingId,
      accessPointId,
    );
    const provider = getAccessProvider(accessPoint.provider);
    let status;

    let statusSource;

    if (typeof provider.getOpenStatus === "function" && openProcessId) {
      status = await provider.getOpenStatus(tenant, openProcessId);
      statusSource = "open_process";
    } else if (bookingContext.lastEvent) {
      status = {
        confirmed: bookingContext.lastEvent.success === true,
        confirmedAt: bookingContext.lastEvent.timestamp || null,
        event: bookingContext.lastEvent,
      };
      statusSource = "last_event";
    } else {
      status = await provider.getStatus(accessPoint, bookingContext);
      statusSource = "provider_status";
    }

    await this._log({
      tenantId: tenant,
      accessPoint,
      bookingId,
      action: "status",
      result: "success",
      payload: status,
      actor: { source: "system" },
    });

    return this._toOpenStatusResponse(status, statusSource);
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
    const status = await provider.getStatus(accessPoint, bookingContext);

    await this._log({
      tenantId: tenant,
      accessPoint,
      bookingId,
      action: "status",
      result: "success",
      payload: status,
      actor: { source: "system" },
    });

    return this._toStatusResponse(status, "provider_status");
  }

  /**
   * @private
   * A provider answer as the API hands it out: the named fields and nothing
   * else. The raw answer stays in the audit log - as long as provider keys
   * slip through, a client can branch on them again, which is exactly what
   * these endpoints are meant to end.
   *
   * `null` carries meaning and is not `false`: it says the provider does not
   * report this.
   *
   * @param {Object} [status={}] The provider's answer
   * @param {string|null} [statusSource=null] Where the answer came from
   * @returns {{ open: boolean|null, locked: boolean|null,
   *   doorOpen: boolean|null, statusSource: string|null }} The status
   */
  static _toStatusResponse(status = {}, statusSource = null) {
    const open = this._resolveOpen(status);

    return {
      open,
      locked: this._resolveLocked(status, open),
      doorOpen: typeof status.doorOpen === "boolean" ? status.doorOpen : null,
      statusSource,
    };
  }

  /**
   * @private
   * The status of an open attempt: the fields of {@link _toStatusResponse}
   * plus what only an attempt can say - whether it was confirmed, and how it
   * failed if it did.
   *
   * @param {Object} [status={}] The provider's answer
   * @param {string|null} [statusSource=null] Where the answer came from
   * @returns {Object} The status of the open attempt
   */
  static _toOpenStatusResponse(status = {}, statusSource = null) {
    return {
      ...this._toStatusResponse(status, statusSource),
      confirmed:
        typeof status.confirmed === "boolean" ? status.confirmed : null,
      errorCode:
        typeof status.errorCode === "string" ||
        typeof status.errorCode === "number"
          ? status.errorCode
          : null,
      errorMessage:
        typeof status.errorMessage === "string" ? status.errorMessage : null,
    };
  }

  /**
   * @private
   * The process id an open answered with, if the provider started one. `null`
   * means the door is already dealt with, a value means there is something to
   * poll - so the answer says by itself whether polling is called for.
   *
   * @param {Object} [result={}] The provider's answer to an open
   * @returns {string|null} The open process id
   */
  static _toOpenProcessId(result = {}) {
    const openProcessId = result?.openProcessId;

    return openProcessId === null || openProcessId === undefined
      ? null
      : String(openProcessId);
  }

  static _resolveOpen(status) {
    if (typeof status.open === "boolean") {
      return status.open;
    }

    if (typeof status.confirmed === "boolean") {
      return status.confirmed;
    }

    if (status.state === "open" || status.state === "unlocked") {
      return true;
    }

    if (status.state === "closed" || status.state === "locked") {
      return false;
    }

    return null;
  }

  static _resolveLocked(status, open) {
    if (typeof status.locked === "boolean") {
      return status.locked;
    }

    if (status.state === "closed" || status.state === "locked") {
      return true;
    }

    if (open === true) {
      return false;
    }

    return null;
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
    const { booking, lockers, doors } = await this._getBookingAccessPoints(
      tenant,
      bookingId,
    );
    const accessRole = this._resolveAccessRole(
      booking,
      userId,
      hasManagePermission,
    );

    return [...lockers, ...doors].map(({ accessPoint, bookingContext }) =>
      projectAccessPoint(accessPoint, { accessRole, bookingContext }),
    );
  }

  /**
   * @private
   * Lockers and doors of a booking as one list of internal entries, lockers
   * first. Everything that needs the full access point - eligibility, the
   * providers, the audit log - works on these; only the API boundary projects
   * them.
   *
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @returns {Promise<{ accessPoint: Object, bookingContext: Object }[]>}
   */
  static async _getBookingAccessPointEntries(tenant, bookingId) {
    const { lockers, doors } = await this._getBookingAccessPoints(
      tenant,
      bookingId,
    );

    return [...lockers, ...doors];
  }

  static async provisionForBooking(tenant, bookingId) {
    const { booking, doors } = await this._getBookingAccessPoints(
      tenant,
      bookingId,
    );
    const provisionedAccessPoints = [];

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

      if (bookingContext.isProvisioned && bookingContext.authorizationId) {
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
        const result = await provider.grantAuthorization(
          accessPoint,
          bookingContext,
        );

        this._upsertAccessInfo(booking, accessPoint, {
          authorizationId: result.authorizationId,
          accessId: result.accessId || result.authorizationId || null,
          saltoUserId: result.saltoUserId || null,
          pin: result.pin ? SecurityUtils.encrypt(result.pin) : null,
          isProvisioned: true,
          provisionedAt: Date.now(),
          providerResponse: result.providerResponse || null,
        });
        if (result.pin) {
          provisionedAccessPoints.push({
            accessPointId: accessPoint.id,
            label: accessPoint.label || accessPoint.id,
            provider: accessPoint.provider,
            bookableTitle: accessPoint.bookableTitle || "",
            pin: result.pin,
          });
        }

        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId,
          action: "provision",
          result: "success",
          payload: {
            authorizationId: result.authorizationId,
            accessId: result.accessId || null,
            saltoUserId: result.saltoUserId || null,
            providerResponse: result.providerResponse || null,
          },
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

    await BookingManager.storeBooking(booking);
    await this._sendProvisionedMail(booking, provisionedAccessPoints);
    return booking.accessInfo;
  }

  static async revokeForBooking(tenant, bookingId) {
    const { booking, doors } = await this._getBookingAccessPoints(
      tenant,
      bookingId,
    );

    await this._revokeResolvedDoors(tenant, booking, doors);
    await BookingManager.storeBooking(booking);
    return booking.accessInfo;
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

      if (
        !bookingContext.authorizationId &&
        !bookingContext.accessId &&
        !bookingContext.saltoUserId
      ) {
        continue;
      }

      const provider = getAccessProvider(accessPoint.provider);

      try {
        const result = await provider.revokeAuthorization(
          accessPoint,
          bookingContext,
        );

        this._upsertAccessInfo(booking, accessPoint, {
          isProvisioned: false,
          revokedAt: Date.now(),
          saltoUserDeletedAt:
            result.userDeleted === true
              ? Date.now()
              : bookingContext.saltoUserDeletedAt || null,
          saltoUserCleanupError:
            result.userDeleted === false
              ? result.providerResponse?.userDeleteError ||
                "Failed to delete Salto KS user"
              : null,
          providerResponse: result.providerResponse || null,
        });

        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId: booking.id,
          action: "revoke",
          result: "success",
          payload: {
            authorizationId: bookingContext.authorizationId,
            accessId: bookingContext.accessId || null,
            saltoUserId: bookingContext.saltoUserId || null,
            providerResponse: result.providerResponse || null,
          },
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

  static async updateForBooking(tenant, oldBooking, newBooking) {
    const changedTime =
      oldBooking.timeBegin !== newBooking.timeBegin ||
      oldBooking.timeEnd !== newBooking.timeEnd;
    const changedAccessPoints =
      (await this._getDoorAccessPointKey(oldBooking, tenant)) !==
      (await this._getDoorAccessPointKey(newBooking, tenant));

    if (!changedTime && !changedAccessPoints) {
      return newBooking.accessInfo || [];
    }

    const { doors: oldDoors } = await this._getBookingAccessPointsFromBooking(
      tenant,
      oldBooking,
    );
    await this._revokeResolvedDoors(tenant, oldBooking, oldDoors);
    return this.provisionForBooking(tenant, newBooking.id);
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

    const eligibility = this._evaluateResolvedEligibility(resolved, {
      userId,
      hasManagePermission,
    });

    return eligibility.operableAccessPointIds.includes(String(accessPointId));
  }

  /**
   * @private
   * Runs {@link evaluateBookingAccessEligibility} for a single, already
   * resolved access point.
   * @param {Object} resolved Access point as returned by {@link _tryResolve}
   * @param {Object} opts
   * @param {string|null} opts.userId Acting user
   * @param {boolean} opts.hasManagePermission Whether the user may manage
   *   the bookings of the tenant
   * @returns {Object} Eligibility as of {@link evaluateBookingAccessEligibility}
   */
  static _evaluateResolvedEligibility(
    { accessPoint, bookingContext, booking },
    { userId, hasManagePermission },
  ) {
    return this.evaluateBookingAccessEligibility(
      booking,
      [this._toEligibilityAccessPoint(accessPoint, bookingContext)],
      { userId, hasManagePermission },
    );
  }

  /**
   * @private
   * Derives the role someone acts in at a booking: `"booker"` when the booking
   * is theirs (owned or assigned), `"manager"` when they may manage someone
   * else's booking, `null` when they may do neither. Ownership beats the
   * manage permission - whoever holds both is the booker at their own booking.
   *
   * The rule stands here alone, so whoever changes "who is what" changes it
   * once. The check is synchronous and reads the already loaded booking, so
   * asking costs no further database access.
   *
   * @param {import("../../entities/booking/booking").Booking} booking
   * @param {string|null} userId Acting user
   * @param {boolean} hasManagePermission Whether the user may manage the
   *   bookings of the tenant
   * @returns {"booker"|"manager"|null} The access role
   */
  static _resolveAccessRole(booking, userId, hasManagePermission) {
    const isOwnBooking = Boolean(
      userId && PermissionsService._isOwner(booking, userId, booking.tenantId),
    );

    if (isOwnBooking) {
      return "booker";
    }

    return hasManagePermission ? "manager" : null;
  }

  /**
   * Evaluates whether a booking's access points can be viewed or operated at a
   * given point in time. Centralises the rules used by {@link canOperate} and
   * the access-bookings list API.
   *
   * @param {import("../../entities/booking/booking").Booking} booking
   * @param {Object[]} accessPoints Access points as returned by
   *   {@link _toEligibilityAccessPoint}
   * @param {Object} [opts]
   * @param {number} [opts.now=Date.now()]
   * @param {string|null} [opts.userId=null]
   * @param {boolean} [opts.hasManagePermission=false]
   * @returns {{
   *   canView: boolean,
   *   canOperate: boolean,
   *   canOperateRemote: boolean,
   *   canUseAuthorization: boolean,
   *   accessRole: "booker"|"manager"|null,
   *   blockingReasons: string[],
   *   primaryBlockingReason: string|null,
   *   operableAccessPointIds: string[],
   * }}
   */
  static evaluateBookingAccessEligibility(
    booking,
    accessPoints = [],
    { now = Date.now(), userId = null, hasManagePermission = false } = {},
  ) {
    const blockingReasons = [];

    if (booking.isRejected) {
      blockingReasons.push(ACCESS_BLOCKING_REASONS.REJECTED);
    }
    if (!booking.isCommitted) {
      blockingReasons.push(ACCESS_BLOCKING_REASONS.NOT_COMMITTED);
    }
    if (booking.priceEur > 0 && !booking.isPayed) {
      blockingReasons.push(ACCESS_BLOCKING_REASONS.PAYMENT_REQUIRED);
    }

    const accessRole = this._resolveAccessRole(
      booking,
      userId,
      hasManagePermission,
    );
    const hasPermission = accessRole !== null;

    const canView = booking.isBookingValid() && hasPermission;
    const operableAccessPointIds = [];
    const remoteOperableAccessPointIds = [];

    let anyInWindow = false;
    let anyRevoked = false;
    let anyNeedsAuthUnprovisioned = false;
    let anyLockerNotReady = false;
    let anyAuthUsable = false;
    let hasRemoteCapablePoint = false;

    for (const point of accessPoints) {
      const pointId = String(point.id);
      const beforeMs = point.accessBuffer?.beforeMs ?? 0;
      const afterMs = point.accessBuffer?.afterMs ?? 0;
      const inBufferedTimeWindow = this._isWithinBufferedTimeWindow(
        booking,
        beforeMs,
        afterMs,
        now,
      );
      const inWindow =
        booking.isBookingValid() &&
        booking.isWithinAccessWindow(beforeMs, afterMs, now);

      if (inBufferedTimeWindow) {
        anyInWindow = true;
      }

      if (this._supportsRemoteMode(point.mode)) {
        hasRemoteCapablePoint = true;
      }

      const accessInfo = this._findAccessInfo(booking, pointId);
      const revokedAt = accessInfo?.revokedAt ?? point.revokedAt ?? null;
      if (revokedAt) {
        anyRevoked = true;
      }

      if (point.type === "locker" && point.isProvisioned === false) {
        anyLockerNotReady = true;
      }

      if (this._usesAuthorization(point.mode)) {
        const isProvisioned =
          point.isProvisioned === true || accessInfo?.isProvisioned === true;
        const hasAuthorizationId = Boolean(
          point.authorizationId || accessInfo?.authorizationId,
        );
        if (!isProvisioned || !hasAuthorizationId) {
          anyNeedsAuthUnprovisioned = true;
        } else if (!revokedAt) {
          anyAuthUsable = true;
        }
      }

      if (!booking.isBookingValid() || !inWindow || !hasPermission) {
        continue;
      }

      operableAccessPointIds.push(pointId);

      if (this._supportsRemoteMode(point.mode)) {
        remoteOperableAccessPointIds.push(pointId);
      }
    }

    if (hasPermission && accessPoints.length > 0 && !anyInWindow) {
      blockingReasons.push(ACCESS_BLOCKING_REASONS.OUTSIDE_ACCESS_WINDOW);
    }
    if (anyRevoked) {
      blockingReasons.push(ACCESS_BLOCKING_REASONS.AUTHORIZATION_REVOKED);
    }
    if (anyNeedsAuthUnprovisioned) {
      blockingReasons.push(ACCESS_BLOCKING_REASONS.NOT_PROVISIONED);
    }
    if (anyLockerNotReady) {
      blockingReasons.push(ACCESS_BLOCKING_REASONS.LOCKER_NOT_READY);
    }
    if (
      canView &&
      anyInWindow &&
      !hasRemoteCapablePoint &&
      accessPoints.length > 0
    ) {
      blockingReasons.push(ACCESS_BLOCKING_REASONS.NO_REMOTE_ACCESS);
    }

    const prioritized = prioritizeBlockingReasons(blockingReasons);

    return {
      canView,
      canOperate: operableAccessPointIds.length > 0,
      canOperateRemote: remoteOperableAccessPointIds.length > 0,
      canUseAuthorization: anyAuthUsable,
      accessRole,
      blockingReasons: prioritized,
      primaryBlockingReason: prioritized[0] ?? null,
      operableAccessPointIds,
    };
  }

  /**
   * Checks whether a user may view (list) the access points assigned to a
   * booking. Unlike {@link canOperate} this does NOT require the booking to
   * be within its (buffered) time window - the assigned access points should
   * be visible at any time as long as the booking is valid (committed, paid
   * if priced, not rejected) and the user is the owner or has the
   * manage-bookings permission.
   */
  static async canView(userId, tenant, bookingId, hasManagePermission) {
    const booking = await BookingManager.getBooking(bookingId, tenant);

    if (!booking) {
      return false;
    }

    if (!booking.isBookingValid()) {
      return false;
    }

    if (hasManagePermission) {
      return true;
    }

    return PermissionsService._isOwner(booking, userId, tenant);
  }

  /**
   * Returns all bookings of a user that grant any access authorization
   * i.e. that resolve to at least one door access point
   * (and, if requested, locker access points).
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
   * @param {boolean} [opts.includeLockers=false] Treat locker access points as an authorization too
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
   * specific access point. The access point may be a door (resolved via the
   * bookables) or, when `includeLockers` is set, a locker (matched via
   * {@link _getLockerAccessPointId}).
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
        const { triggerIds, mode } = triggerByTenant.get(booking.tenantId) || {
          triggerIds: new Set(),
          mode: null,
        };
        return this._resolveBookingAccessForPoint(
          booking,
          accessPointId,
          mode,
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
      let eligibilityPoints = null;
      if (needsEnrichment) {
        entries = await this._getFilteredBookingAccessPointEntries(
          booking.tenantId,
          booking.id,
          { capability, includeLockers },
        );
        eligibilityPoints = entries.map(({ accessPoint, bookingContext }) =>
          this._toEligibilityAccessPoint(accessPoint, bookingContext),
        );
      }

      if (
        !this._matchesState(
          booking,
          state,
          now,
          includeBuffer,
          eligibilityPoints,
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

      const hasManagePermission =
        managePermissionByTenant?.get(booking.tenantId) ?? false;
      // Determined before the blocks below, because they hang on separate
      // flags. The eligibility asks the same deriver for itself and reports
      // the role in its answer - one rule, one place, whoever asks.
      const accessRole = this._resolveAccessRole(
        booking,
        userId,
        hasManagePermission,
      );

      if (includeAccessPoints) {
        result.accessPoints = (entries || []).map(
          ({ accessPoint, bookingContext }) =>
            projectAccessPoint(accessPoint, { accessRole, bookingContext }),
        );
      }

      if (includeEligibility) {
        result.accessEligibility = this.evaluateBookingAccessEligibility(
          booking,
          eligibilityPoints || [],
          { now, userId, hasManagePermission },
        );
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
   * @returns {Promise<Map<string, Map<string, string>>>} bookableId -> (accessPointId -> mode)
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
          accessPointsById.get(accessPointId).mode ||
            AccessPointMode.AUTHORIZATION,
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
   * given access point, plus the access point's mode.
   * @returns {Promise<{ triggerIds: Set<string>, mode: string|null }>}
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

    if (apBookables.length > 0) {
      const accessPoint = await AccessPointManager.getAccessPoint(
        accessPointId,
        tenant,
      );
      if (accessPoint) {
        mode = accessPoint.mode || AccessPointMode.AUTHORIZATION;
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

    return { triggerIds, mode };
  }

  /**
   * @private
   * Resolves which access point ids a booking confers, using the precomputed
   * trigger map. Honors the `capability` and `includeLockers` options.
   */
  static _resolveBookingAccess(
    booking,
    triggerMap,
    { capability, includeLockers },
  ) {
    const directIds = this._getBookableIds(booking);
    const onlyAuthorization = capability === "authorization";
    const seen = new Set();
    const accessPointIds = [];

    for (const bookableId of directIds) {
      const pointMap = triggerMap.get(bookableId);
      if (!pointMap) {
        continue;
      }

      for (const [accessPointId, mode] of pointMap) {
        if (seen.has(accessPointId)) {
          continue;
        }
        if (onlyAuthorization && !this._usesAuthorization(mode)) {
          continue;
        }
        seen.add(accessPointId);
        accessPointIds.push(accessPointId);
      }
    }

    if (includeLockers && !onlyAuthorization) {
      for (const lockerInfo of booking.lockerInfo || []) {
        const lockerId = this._getLockerAccessPointId(lockerInfo);
        if (lockerId && !seen.has(String(lockerId))) {
          seen.add(String(lockerId));
          accessPointIds.push(String(lockerId));
        }
      }
    }

    return { accessPointIds };
  }

  /**
   * @private
   * Resolves whether a booking confers a single, specific access point.
   */
  static _resolveBookingAccessForPoint(
    booking,
    accessPointId,
    mode,
    { triggerIds, capability, includeLockers },
  ) {
    const onlyAuthorization = capability === "authorization";
    const targetId = String(accessPointId);

    const directIds = this._getBookableIds(booking);
    const matchesDoor =
      triggerIds.size > 0 &&
      directIds.some((id) => triggerIds.has(id)) &&
      !(onlyAuthorization && !this._usesAuthorization(mode));

    const matchesLocker =
      includeLockers &&
      !onlyAuthorization &&
      (booking.lockerInfo || []).some(
        (info) => String(this._getLockerAccessPointId(info)) === targetId,
      );

    if (!matchesDoor && !matchesLocker) {
      return { accessPointIds: [] };
    }

    return { accessPointIds: [targetId] };
  }

  /**
   * @private
   * Loads the access point entries of a booking and applies the
   * capability/locker filters. Entries rather than the projection, because the
   * eligibility decision needs fields a client never sees.
   *
   * @param {string} tenant Tenant ID
   * @param {string} bookingId Booking ID
   * @param {Object} filters
   * @param {string|null} filters.capability `"authorization"` to keep only the
   *   access points a booking holds an authorization for
   * @param {boolean} filters.includeLockers Whether lockers count as access
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
      if (accessPoint.type === "locker") {
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
    enrichedPoints,
    includeEligibility = false,
  ) {
    switch (state) {
      case "active":
        if (includeBuffer) {
          const { beforeMs, afterMs } = this._maxBuffer(enrichedPoints);
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
  static _maxBuffer(enrichedPoints) {
    let beforeMs = 0;
    let afterMs = 0;
    for (const point of enrichedPoints || []) {
      const buffer = point.accessBuffer || {};
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
   * booking nor an access point outside the booking is an eligibility
   * decision, so there is no reason vocabulary and nothing to audit against.
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

    const { lockers, doors } = await this._getBookingAccessPointsFromBooking(
      tenant,
      booking,
    );
    const resolved = [...lockers, ...doors].find(
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

  static async _getBookingAccessPointsFromBooking(tenant, booking) {
    const lockers = this._getLockerAccessPoints(tenant, booking);
    const doors = await this._getDoorAccessPoints(tenant, booking);

    return { booking, lockers, doors };
  }

  /**
   * @private
   * Returns the access-point id exposed for a locker. For iFBS lockers this is
   * the box number (`ifbsMetadata.nummer`); other providers keep `processId`.
   */
  static _getLockerAccessPointId(lockerInfo) {
    if (
      lockerInfo.lockerSystem === "ifbs" &&
      lockerInfo.ifbsMetadata?.nummer != null
    ) {
      return String(lockerInfo.ifbsMetadata.nummer);
    }

    return lockerInfo.processId;
  }

  static _getLockerAccessPoints(tenant, booking) {
    const beforeMs = 0;
    const afterMs = 0;

    return (booking.lockerInfo || []).map((lockerInfo) => ({
      accessPoint: {
        id: this._getLockerAccessPointId(lockerInfo),
        tenantId: tenant,
        provider: lockerInfo.lockerSystem,
        type: "locker",
        mode: AccessPointMode.REMOTE,
      },
      bookingContext: {
        tenant,
        bookingId: booking.id,
        timeBegin: booking.timeBegin,
        timeEnd: booking.timeEnd,
        externalBookingId: lockerInfo.processId,
        lastOpenBoxId: lockerInfo.ifbsMetadata?.lastOpenBoxId,
        accessBuffer: { beforeMs, afterMs },
        accessFrom: booking.timeBegin - beforeMs,
        accessTo: booking.timeEnd + afterMs,
      },
    }));
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
   * @returns {Promise<Map<string, AccessPoint>>} accessPointId -> access point
   */
  static async _getAccessPointsById(tenant, bookables) {
    const accessPointIds = [
      ...new Set(
        bookables.flatMap((bookable) =>
          (bookable.accessPointDetails?.accessPointIds || []).map(String),
        ),
      ),
    ];
    const accessPoints = await AccessPointManager.getAccessPointsByIds(
      tenant,
      accessPointIds,
    );

    return new Map(
      accessPoints.map((accessPoint) => [String(accessPoint.id), accessPoint]),
    );
  }

  static async _getDoorAccessPoints(tenant, booking) {
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
    );
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

          if (!accessPoint || seenAccessPointIds.has(accessPointKey)) {
            return [];
          }
          seenAccessPointIds.add(accessPointKey);

          const accessInfo = (booking.accessInfo || []).find(
            (info) => String(info.accessPointId) === accessPointKey,
          );
          // The resolved copy carries the rule *types* so a client can be told
          // what it has to prove, but neither the rule configuration nor the
          // scan code they are checked against - the evidence check reads the
          // stored access point again for those.
          const resolvedAccessPoint = {
            id: accessPoint.id,
            tenantId: tenant,
            type: "door",
            provider: accessPoint.provider,
            externalId: accessPoint.externalId,
            label: accessPoint.label || "",
            mode: accessPoint.mode || AccessPointMode.AUTHORIZATION,
            validationRuleTypes: (accessPoint.validationRules || []).map(
              (rule) => rule.type,
            ),
            bookableId: bookable.id,
            bookableTitle: bookable.title,
            relation: bookableRelations.get(bookable.id) || "self",
          };

          return [
            {
              accessPoint: resolvedAccessPoint,
              bookingContext: {
                tenant,
                bookingId: booking.id,
                timeBegin: booking.timeBegin,
                timeEnd: booking.timeEnd,
                accessBuffer: { beforeMs, afterMs },
                accessFrom: booking.timeBegin - beforeMs,
                accessTo: booking.timeEnd + afterMs,
                booking,
                accessInfo,
                authorizationId: accessInfo?.authorizationId || null,
                accessId: accessInfo?.accessId || null,
                saltoUserId: accessInfo?.saltoUserId || null,
                isProvisioned: accessInfo?.isProvisioned || false,
                provisionedAt: accessInfo?.provisionedAt || null,
                revokedAt: accessInfo?.revokedAt || null,
                saltoUserDeletedAt: accessInfo?.saltoUserDeletedAt || null,
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

  static _supportsRemoteMode(mode) {
    return mode === AccessPointMode.REMOTE || mode === AccessPointMode.BOTH;
  }

  static _findAccessInfo(booking, accessPointId) {
    return (booking.accessInfo || []).find(
      (info) => String(info.accessPointId) === String(accessPointId),
    );
  }

  static _toEligibilityAccessPoint(accessPoint, bookingContext) {
    if (accessPoint.type === "locker") {
      return {
        ...accessPoint,
        isProvisioned: true,
        accessBuffer: bookingContext.accessBuffer || {
          beforeMs: 0,
          afterMs: 0,
        },
        accessFrom: bookingContext.accessFrom ?? null,
        accessTo: bookingContext.accessTo ?? null,
      };
    }

    return {
      ...accessPoint,
      authorizationId: bookingContext.authorizationId || null,
      isProvisioned: bookingContext.isProvisioned || false,
      revokedAt: bookingContext.revokedAt || null,
      accessBuffer: bookingContext.accessBuffer || { beforeMs: 0, afterMs: 0 },
      accessFrom: bookingContext.accessFrom ?? null,
      accessTo: bookingContext.accessTo ?? null,
    };
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

  static async _getDoorAccessPointKey(booking, tenant) {
    const doors = await this._getDoorAccessPoints(tenant, booking);
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
