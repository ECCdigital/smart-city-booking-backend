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
   * GET /:tenant/access/:accessPointId/open-status?openProcessId=15682&bookingId=123
   */
  static async getOpenStatus(request, response) {
    try {
      const { tenant, accessPointId } = request.params;
      const { openProcessId, bookingId } = request.query;
      const user = request.user;

      if (!openProcessId) {
        return ApiResponse.error(
          response,
          "Missing openProcessId query parameter",
        );
      }

      const allowed = await AccessController._canOperate(
        user.id,
        tenant,
        bookingId,
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
   * GET /:tenant/access-points
   * Returns all access points linked to a booking.
   */
  static async getAccessPoints(request, response) {
    try {
      const { tenant } = request.params;
      const { bookingId } = request.query;
      const user = request.user;

      const allowed = await AccessController._canOperate(
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
   * Checks booking ownership + active time window.
   */
  static async _canOperate(userId, tenant, bookingId) {
    const hasPermission = await PermissionService._allowUpdateAny(
      userId,
      tenant,
      RolePermission.MANAGE_BOOKINGS,
    );
    if (hasPermission) return true;

    return AccessService.isBookingOwnerAndActive(userId, tenant, bookingId);
  }
}

module.exports = AccessController;
