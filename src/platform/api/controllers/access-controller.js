const bunyan = require("bunyan");
const PermissionService = require("../../../commons/services/permission-service");
const { RolePermission } = require("../../../commons/entities/role/role");
const AccessService = require("../../../commons/services/access/access-service");

const logger = bunyan.createLogger({
  name: "access-controller.js",
  level: process.env.LOG_LEVEL,
});

class AccessController {
  /**
   * POST /:tenant/bookings/:bookingId/access/:accessPointId/open
   */
  static async open(request, response) {
    try {
      const { tenant, bookingId, accessPointId } = request.params;
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

      console.log(`Access point opened with result:`, result);

      logger.info(
        `${tenant} -- user ${user.id} opened access-point ${accessPointId} (booking ${bookingId})`,
      );
      response.status(200).send(result);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not open access point");
    }
  }

  /**
   * GET /:tenant/bookings/:bookingId/access/:accessPointId/open-status?openBoxId=15682
   */
  static async getOpenStatus(request, response) {
    try {
      console.log("Getting open status with query:", request.query);
      const { tenant, bookingId, accessPointId } = request.params;
      const { openBoxId } = request.query;
      const user = request.user;

      if (!openBoxId) {
        return response.status(400).send("Missing openBoxId");
      }

      const allowed = await AccessController._canOperate(
        user.id,
        tenant,
        bookingId,
      );

      console.log(`User ${user.id} access check for booking ${bookingId}:`, allowed);

      if (!allowed) return response.sendStatus(403);

      const status = await AccessService.getOpenStatus(
        tenant,
        bookingId,
        accessPointId,
        openBoxId,
      );

      console.log(`Open status for booking ${bookingId}, access point ${accessPointId}, openBoxId ${openBoxId}:`, status);

      response.status(200).send(status);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get open status");
    }
  }

  /**
   * GET /:tenant/bookings/:bookingId/access-points
   * Returns all access points linked to a booking.
   */
  static async getAccessPoints(request, response) {
    try {
      const { tenant, bookingId } = request.params;
      const user = request.user;

      const allowed = await AccessController._canOperate(
        user.id,
        tenant,
        bookingId,
      );
      if (!allowed) return response.sendStatus(403);

      const points = await AccessService.getByBooking(tenant, bookingId);

      response.status(200).send(points);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get access points");
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