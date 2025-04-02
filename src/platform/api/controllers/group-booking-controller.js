const GroupBookingManager = require("../../../commons/data-managers/group-booking-manager");
const bunyan = require("bunyan");
const PermissionsService = require("../../../commons/services/permission-service");
const { RolePermission } = require("../../../commons/entities/role");

const logger = bunyan.createLogger({
  name: "group-booking-controller.js",
  level: process.env.LOG_LEVEL,
});

class GroupBookingController {
  static async getGroupBookings(req, res) {
    try {
      const tenantId = req.params.tenant;
      const user = req.user;

      const groupBookings =
        await GroupBookingManager.getGroupBookings(tenantId);

      logger.info(
        { tenantId: tenantId, user: user.id },
        "Group bookings retrieved successfully",
      );

      res.status(200).send(groupBookings);
    } catch (error) {
      res.status(500).send({ message: error.message });
    }
  }

  static async getGroupBooking(req, res) {
    try {
      const tenantId = req.params.tenant;
      const user = req.user;
      const groupBookingId = req.params.id;

      const populate = req.query.populate === "true";

      const groupBooking = await GroupBookingManager.getGroupBooking(
        tenantId,
        groupBookingId,
        populate,
      );

      if (
        user &&
        (await PermissionsService._allowRead(
          groupBooking,
          user.id,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        ))
      ) {
        logger.info(
          { tenantId: tenantId, user: user.id },
          "Group booking retrieved successfully",
        );
        res.status(200).send(groupBooking);
      } else {
        logger.error(
          { tenantId: tenantId, user: user.id },
          "User not allowed to read group booking",
        );
        res.status(403).send({
          message: "User not allowed to read group booking",
        });
      }
    } catch (error) {
      res.status(500).send({ message: error.message });
    }
  }

  static async getGroupBookingByBookingId(req, res) {
    try {
      const tenantId = req.params.tenant;
      const user = req.user;
      const bookingId = req.params.bookingId;
      const populate = req.query.populate === "true";

      const groupBooking = await GroupBookingManager.getGroupBookingByBookingId(
        tenantId,
        bookingId,
        populate,
      );

      if (
        user &&
        (await PermissionsService._allowRead(
          groupBooking,
          user.id,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        ))
      ) {
        logger.info(
          { tenantId: tenantId, user: user.id },
          "Group booking retrieved successfully",
        );
        res.status(200).send(groupBooking);
      } else {
        logger.error(
          { tenantId: tenantId, user: user.id },
          "User not allowed to read group booking",
        );
        res.status(403).send({
          message: "User not allowed to read group booking",
        });
      }
    } catch (error) {
      res.status(500).send({ message: error.message });
    }
  }
}

module.exports = { GroupBookingController };
