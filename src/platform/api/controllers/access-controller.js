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
