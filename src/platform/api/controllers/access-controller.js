const bunyan = require("bunyan");
const PermissionService = require("../../../commons/services/permission-service");
const { RolePermission } = require("../../../commons/entities/role/role");
const AccessService = require("../../../commons/services/access/access-service");
const ApiResponse = require("../../../commons/utilities/api-response");

const logger = bunyan.createLogger({
  name: "access-controller.js",
  level: process.env.LOG_LEVEL,
});

class AccessController {
  /**
   * POST /:tenant/access/:accessPointId/open
   */
  static async open(request, response) {
    try {
      const { tenant, accessPointId } = request.params;
      const { bookingId } = request.query;
      const otp = request.body?.otp || request.query?.otp || null;
      const user = request.user;

      const allowed = await AccessController._canOperate(
        user.id,
        tenant,
        bookingId,
        accessPointId,
      );
      if (!allowed) return response.sendStatus(403);

      const result = await AccessService.open(
        tenant,
        bookingId,
        accessPointId,
        user.id,
        { otp },
      );

      logger.info(
        `${tenant} -- user ${user.id} opened access-point ${accessPointId} (booking ${bookingId})`,
      );
      return ApiResponse.ok(response, { data: result });
    } catch (err) {
      logger.error(err);
      return ApiResponse.error(response, "Could not open access point");
    }
  }

  /**
   * POST /:tenant/access/:accessPointId/unlatch
   */
  static async unlatch(request, response) {
    try {
      const { tenant, accessPointId } = request.params;
      const { bookingId } = request.query;
      const user = request.user;

      const allowed = await AccessController._canOperate(
        user.id,
        tenant,
        bookingId,
        accessPointId,
      );
      if (!allowed) return response.sendStatus(403);

      const result = await AccessService.unlatch(
        tenant,
        bookingId,
        accessPointId,
        user.id,
      );

      logger.info(
        `${tenant} -- user ${user.id} unlatched access-point ${accessPointId} (booking ${bookingId})`,
      );
      return ApiResponse.ok(response, { data: result });
    } catch (err) {
      logger.error(err);
      return ApiResponse.error(response, "Could not unlatch access point");
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

      const allowed = await AccessController._canOperate(
        user.id,
        tenant,
        bookingId,
        accessPointId,
      );
      if (!allowed) return response.sendStatus(403);

      const result = await AccessService.close(
        tenant,
        bookingId,
        accessPointId,
        user.id,
      );

      logger.info(
        `${tenant} -- user ${user.id} closed access-point ${accessPointId} (booking ${bookingId})`,
      );
      return ApiResponse.ok(response, { data: result });
    } catch (err) {
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

      const allowed = await AccessController._canOperate(
        user.id,
        tenant,
        bookingId,
        accessPointId,
      );

      if (!allowed) return response.sendStatus(403);

      const status = await AccessService.getOpenStatus(
        tenant,
        bookingId,
        accessPointId,
        openProcessId,
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

      const allowed = await AccessController._canOperate(
        user.id,
        tenant,
        bookingId,
        accessPointId,
      );

      if (!allowed) return response.sendStatus(403);

      const status = await AccessService.getStatus(
        tenant,
        bookingId,
        accessPointId,
      );

      return ApiResponse.ok(response, { data: status });
    } catch (err) {
      logger.error(err);
      return ApiResponse.error(response, "Could not get access point status");
    }
  }

  /**
   * GET /:tenant/access-points
   * Returns all access points linked to a booking.
   */
  static async getAccessPoints(request, response) {
    try {
      const { tenant } = request.params;
      const { bookingId } = request.query;
      const user = request.user;

      const allowed = await AccessController._canView(
        user.id,
        tenant,
        bookingId,
      );
      if (!allowed) return response.sendStatus(403);

      const points = await AccessService.getByBooking(tenant, bookingId);

      return ApiResponse.ok(response, { data: points });
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
  static async getAccessBookings(request, response) {
    try {
      const options = AccessController._parseAccessBookingQuery(request.query);
      if (options.error) {
        return ApiResponse.badRequest(response, options.error);
      }

      const targetUserId = await AccessController._resolveTargetUser(request);
      if (!targetUserId) {
        return response.sendStatus(403);
      }

      const bookings = await AccessService.getUserBookingsWithAccess(
        targetUserId,
        options,
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
  static async getAccessPointBookings(request, response) {
    try {
      const { accessPointId } = request.params;

      const options = AccessController._parseAccessBookingQuery(request.query);
      if (options.error) {
        return ApiResponse.badRequest(response, options.error);
      }

      const targetUserId = await AccessController._resolveTargetUser(request);
      if (!targetUserId) {
        return response.sendStatus(403);
      }

      const bookings = await AccessService.getUserBookingsForAccessPoint(
        targetUserId,
        accessPointId,
        options,
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
    };
  }

  /**
   * @private
   * Resolves the user whose bookings should be returned. Defaults to the
   * authenticated user. Because the lookup is tenant-independent, querying
   * another user via `?userId=` requires instance ownership. Returns null when
   * not allowed.
   */
  static async _resolveTargetUser(request) {
    const requestedUserId = request.query.userId;
    const currentUserId = request.user.id;

    if (!requestedUserId || requestedUserId === currentUserId) {
      return currentUserId;
    }

    const isInstanceOwner =
      await PermissionService._isInstanceOwner(currentUserId);

    return isInstanceOwner ? requestedUserId : null;
  }

  /**
   * @private
   * Checks that the booking is active (committed, paid if priced, not rejected
   * and within its time window) and that the user is either the booking owner
   * or has the manage-bookings permission. The booking conditions apply to
   * everyone, including managers/admins.
   */
  static async _canOperate(userId, tenant, bookingId, accessPointId) {
    const hasManagePermission = await PermissionService._allowUpdateAny(
      userId,
      tenant,
      RolePermission.MANAGE_BOOKINGS,
    );

    return AccessService.canOperate(
      userId,
      tenant,
      bookingId,
      accessPointId,
      hasManagePermission,
    );
  }

  /**
   * @private
   * Checks that the booking is valid (committed, paid if priced, not rejected)
   * and that the user is either the booking owner or has the manage-bookings
   * permission. In contrast to {@link _canOperate} this does NOT check the
   * (buffered) time window, so the access points assigned to a booking can be
   * listed at any time.
   */
  static async _canView(userId, tenant, bookingId) {
    const hasManagePermission = await PermissionService._allowUpdateAny(
      userId,
      tenant,
      RolePermission.MANAGE_BOOKINGS,
    );

    return AccessService.canView(
      userId,
      tenant,
      bookingId,
      hasManagePermission,
    );
  }
}

module.exports = AccessController;
