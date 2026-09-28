const bunyan = require("bunyan");
const {
  anyReachIn,
  scopeOf,
} = require("../../../commons/services/authorization");
const AccessService = require("../../../commons/services/access/access-service");
const AccessScanService = require("../../../commons/services/access/access-scan-service");
const ApiResponse = require("../../../commons/utilities/api-response");
const { ForbiddenError } = require("../../../errors/BaseError");
const { AccessOpenError } = require("../../../errors/AccessOpenError");
const { LockBusyError } = require("../../../errors/LockBusyError");
const {
  LockUnreachableError,
} = require("../../../errors/LockUnreachableError");

const logger = bunyan.createLogger({
  name: "access-controller.js",
  level: process.env.LOG_LEVEL,
});

class AccessController {
  /**
   * POST /:tenant/access/:accessPointId/open
   *
   * The eligibility decision belongs to the service, which audits refusals.
   * This renders its outcome: refusals are soft failures on HTTP 200 so the
   * client can show the reasons.
   *
   * The body may carry `evidence` for the access point's validation rules and
   * a `channel` saying how the client got here. The channel is passed on as
   * reported - it is diagnostic context for the audit, not something the
   * server acts on - while evidence of the wrong shape is dropped, so a
   * malformed body reads as "no evidence sent" rather than an error.
   */
  static async open(request, response) {
    return AccessController._renderOpen(request, response, {
      action: "open",
      errorMessage: "Could not open access point",
    });
  }

  /**
   * Lock Busy and Lock Unreachable are states of the lock, not decisions of
   * the platform: they go out with their own status - a real 423 so the
   * client waits out its Cooldown instead of reading it as a refusal, a 503
   * so it says the lock is unreachable instead of offering to turn it.
   * Shared by open, close and the status read.
   */
  static _renderLockState(
    response,
    err,
    { tenant, action, accessPointId, bookingId },
  ) {
    logger.info(
      `${tenant} -- ${action} of access-point ${accessPointId} (booking ${bookingId}) refused, ${err.code}: ${err.message}`,
    );
    return ApiResponse.fail(response, err);
  }

  /** @private Whether {@link _renderLockState} is the way to answer `err`. */
  static _isLockState(err) {
    return err instanceof LockBusyError || err instanceof LockUnreachableError;
  }

  /**
   * @private
   * Renders the way through a door as the service decided it: a refusal is
   * a soft failure on HTTP 200 with its reasons, an access point outside the
   * booking is a 403.
   *
   * @param {Object} request Express request
   * @param {Object} response Express response
   * @param {Object} options
   * @param {"open"} options.action The service method to call, which is also
   *   what the audit entry is filed under
   * @param {string} options.errorMessage What to say when nothing else fits
   * @returns {Promise<Object>} The Express response
   */
  static async _renderOpen(request, response, { action, errorMessage }) {
    const { tenant, accessPointId } = request.params;
    const { bookingId } = request.query;
    const evidence = Array.isArray(request.body?.evidence)
      ? request.body.evidence
      : [];
    const channel =
      typeof request.body?.channel === "string" ? request.body.channel : null;
    const user = request.user;

    try {
      const scope = scopeOf(request);

      const outcome = await AccessService[action](
        tenant,
        bookingId,
        accessPointId,
        user.id,
        { scope, evidence, channel },
      );

      if (!outcome.success) {
        logger.info(
          `${tenant} -- user ${user.id} was denied access-point ${accessPointId} (booking ${bookingId}): ${outcome.blockingReasons.join(", ")}`,
        );
        return ApiResponse.softFail(response, {
          data: { blockingReasons: outcome.blockingReasons },
        });
      }

      logger.info(
        `${tenant} -- user ${user.id} ${action}ed access-point ${accessPointId} (booking ${bookingId})`,
      );
      return ApiResponse.ok(response, { data: outcome.data });
    } catch (err) {
      if (err instanceof ForbiddenError) {
        logger.warn(
          `${tenant} -- user ${user.id} tried to ${action} access-point ${accessPointId} outside booking ${bookingId}`,
        );
        return response.sendStatus(403);
      }

      if (AccessController._isLockState(err)) {
        return AccessController._renderLockState(response, err, {
          tenant,
          action,
          accessPointId,
          bookingId,
        });
      }

      if (err instanceof AccessOpenError) {
        // The guest is told only the failure class - temporary ("try again in
        // a few minutes") or configuration ("contact the administration").
        // The provider detail is already in the audit log.
        logger.warn(
          `${tenant} -- ${action} of access-point ${accessPointId} (booking ${bookingId}) failed (${err.failureClass}): ${err.message}`,
        );
        return ApiResponse.softFail(response, {
          data: { openFailure: err.failureClass },
        });
      }

      logger.error(err);
      return ApiResponse.error(response, errorMessage);
    }
  }

  /**
   * GET /:tenant/access/resolve-scan/:scanCode
   *
   * Translates a scanned sticker into the door it belongs to. Deliberately
   * behind a login: nobody may turn a code into a door name without an
   * account. A code that does not resolve is a soft failure on HTTP 200, so
   * the scanning client can tell the two failures apart and say what to do.
   *
   * The manage permission is not asked for here: a code alone names no
   * booking, so nobody acts in an access role yet and there is nothing to
   * waive.
   */
  static async resolveScan(request, response) {
    const { tenant, scanCode } = request.params;
    const user = request.user;

    try {
      const outcome = await AccessScanService.resolveScanCode(
        tenant,
        scanCode,
        user.id,
      );

      if (!outcome.success) {
        return ApiResponse.softFail(response, { data: outcome.data });
      }

      return ApiResponse.ok(response, { data: outcome.data });
    } catch (err) {
      logger.error(err);
      return ApiResponse.error(response, "Could not resolve scan code");
    }
  }

  /**
   * POST /:tenant/access/:accessPointId/close
   */
  static async close(request, response) {
    try {
      const { tenant, accessPointId } = request.params;
      const { bookingId } = request.query;
      const user = request.user;
      const scope = scopeOf(request);

      const allowed = await AccessService.canOperate(
        user.id,
        tenant,
        bookingId,
        accessPointId,
        scope,
      );
      if (!allowed) return response.sendStatus(403);

      const result = await AccessService.close(
        tenant,
        bookingId,
        accessPointId,
        user.id,
        { scope },
      );

      logger.info(
        `${tenant} -- user ${user.id} closed access-point ${accessPointId} (booking ${bookingId})`,
      );
      return ApiResponse.ok(response, { data: result });
    } catch (err) {
      if (AccessController._isLockState(err)) {
        return AccessController._renderLockState(response, err, {
          tenant: request.params.tenant,
          action: "close",
          accessPointId: request.params.accessPointId,
          bookingId: request.query.bookingId,
        });
      }

      logger.error(err);
      return ApiResponse.error(response, "Could not close access point");
    }
  }

  /**
   * GET /:tenant/access/:accessPointId/open-status?openProcessId=15682&bookingId=123
   */
  static async getOpenStatus(request, response) {
    try {
      const { tenant, accessPointId } = request.params;
      const { openProcessId, bookingId } = request.query;
      const user = request.user;
      const scope = scopeOf(request);

      const allowed = await AccessService.canOperate(
        user.id,
        tenant,
        bookingId,
        accessPointId,
        scope,
      );

      if (!allowed) return response.sendStatus(403);

      const status = await AccessService.getOpenStatus(
        tenant,
        bookingId,
        accessPointId,
        openProcessId,
        user.id,
        { scope },
      );

      return ApiResponse.ok(response, { data: status });
    } catch (err) {
      logger.error(err);
      return ApiResponse.error(response, "Could not get open status");
    }
  }

  /**
   * GET /:tenant/access/:accessPointId/status?bookingId=123
   */
  static async getStatus(request, response) {
    try {
      const { tenant, accessPointId } = request.params;
      const { bookingId } = request.query;
      const user = request.user;
      const scope = scopeOf(request);

      const allowed = await AccessService.canOperate(
        user.id,
        tenant,
        bookingId,
        accessPointId,
        scope,
      );

      if (!allowed) return response.sendStatus(403);

      const status = await AccessService.getStatus(
        tenant,
        bookingId,
        accessPointId,
        user.id,
        { scope },
      );
      return ApiResponse.ok(response, { data: status });
    } catch (err) {
      if (AccessController._isLockState(err)) {
        return AccessController._renderLockState(response, err, {
          tenant: request.params.tenant,
          action: "status",
          accessPointId: request.params.accessPointId,
          bookingId: request.query.bookingId,
        });
      }

      logger.error(err);
      return ApiResponse.error(response, "Could not get access point status");
    }
  }

  /**
   * GET /:tenant/access-points
   *
   * Returns all access points linked to a booking. Listing them does not
   * require the booking to be within its time window - what a booking opens
   * should be readable at any time - and the manage permission is resolved
   * once: it decides whether the booking may be seen at all, and together with
   * the asking user it decides the role they act in, which says what they have
   * to prove at its doors. Who owns the booking stays in the domain; the
   * controller only names the user.
   */
  static async getAccessPoints(request, response) {
    try {
      const { tenant } = request.params;
      const { bookingId } = request.query;
      const user = request.user;

      const scope = scopeOf(request);
      const allowed = await AccessService.canView(
        user.id,
        tenant,
        bookingId,
        scope,
      );
      if (!allowed) return response.sendStatus(403);

      // The decision the points were projected by travels beside them, so
      // the storefront's booking details can operate the doors without a
      // second round trip. Consumers reading only `data` see no change.
      const { points, accessEligibility } =
        await AccessService.getByBookingWithEligibility(tenant, bookingId, {
          userId: user.id,
          scope,
        });

      return ApiResponse.ok(response, { data: points, accessEligibility });
    } catch (err) {
      logger.error(err);
      return ApiResponse.error(response, "Could not get access points");
    }
  }

  /**
   * GET /access/bookings
   * Tenant-independent: returns all bookings of a person (across all tenants)
   * that grant an access authorization, optionally filtered by
   * state/capability/lockers.
   */
  static async getAccessBookings(request, response, next) {
    try {
      const options = AccessController._parseAccessBookingQuery(request.query);
      if (options.error) {
        return ApiResponse.badRequest(response, options.error);
      }

      const targetUserId = AccessService.targetUserOf(
        scopeOf(request),
        request.query.userId,
      );
      if (!targetUserId) {
        return next(new ForbiddenError());
      }

      const bookings = await AccessService.getUserBookingsWithAccess(
        targetUserId,
        {
          ...options,
          canManageIn: AccessController._canManageIn(targetUserId),
        },
      );

      return ApiResponse.ok(response, { data: bookings });
    } catch (err) {
      logger.error(err);
      return ApiResponse.error(response, "Could not get access bookings");
    }
  }

  /**
   * GET /access/access-points/:accessPointId/bookings
   * Tenant-independent: returns all bookings of a person (across all tenants)
   * that grant an access authorization for a specific access point.
   */
  static async getAccessPointBookings(request, response, next) {
    try {
      const { accessPointId } = request.params;

      const options = AccessController._parseAccessBookingQuery(request.query);
      if (options.error) {
        return ApiResponse.badRequest(response, options.error);
      }

      const targetUserId = AccessService.targetUserOf(
        scopeOf(request),
        request.query.userId,
      );
      if (!targetUserId) {
        return next(new ForbiddenError());
      }

      const bookings = await AccessService.getUserBookingsForAccessPoint(
        targetUserId,
        accessPointId,
        {
          ...options,
          canManageIn: AccessController._canManageIn(targetUserId),
        },
      );

      return ApiResponse.ok(response, { data: bookings });
    } catch (err) {
      logger.error(err);
      return ApiResponse.error(response, "Could not get access point bookings");
    }
  }

  /**
   * @private
   * Parses and validates the query parameters shared by the access booking
   * routes. Returns an options object or `{ error }` on invalid input.
   */
  static _parseAccessBookingQuery(query = {}) {
    const allowedStates = ["active", "upcoming", "past", "all"];
    const state = query.filter || query.state || "all";
    if (!allowedStates.includes(state)) {
      return {
        error: `Invalid filter '${state}'. Allowed: ${allowedStates.join(", ")}`,
      };
    }

    let capability = null;
    if (query.capability !== undefined) {
      if (query.capability !== "authorization") {
        return {
          error: `Invalid capability '${query.capability}'. Allowed: authorization`,
        };
      }
      capability = "authorization";
    }

    return {
      state,
      capability,
      includeAccessPoints: query.includeAccessPoints === "true",
      includeLockers: query.includeLockers === "true",
      includeBuffer: query.includeBuffer === "true",
      includeEligibility: query.includeEligibility === "true",
    };
  }

  /**
   * @private
   * The manager question asked per tenant: whether the
   * user manages the bookings of that tenant. The two tenant-independent
   * lists need it, and the reach of their route is one of the instance -
   * an instance answers nothing about a tenant. So this hands the service
   * a function (`anyReachIn`) that asks what the marker of a
   * tenant route asks, loaded once and only when the service asks - in a
   * tenant whose membership rests (glossary "Ruhende Mitgliedschaft") the
   * user manages nothing.
   *
   * The user is the one whose bookings are listed, not always the caller:
   * with `?userId=` an instance owner reads someone else's list, and what
   * it shows is what *they* would meet at the door.
   *
   * @param {string} userId
   * @returns {(tenantId: string) => Promise<boolean>}
   */
  static _canManageIn(userId) {
    return anyReachIn(userId, "booking", "operate");
  }
}

module.exports = AccessController;
