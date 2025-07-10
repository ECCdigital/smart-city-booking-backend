const GroupBookingManager = require("../../../commons/data-managers/group-booking-manager");
const bunyan = require("bunyan");
const PermissionsService = require("../../../commons/services/permission-service");
const { RolePermission } = require("../../../commons/entities/role/role");
const BookingService = require("../../../commons/services/checkout/booking-service");
const WorkflowService = require("../../../commons/services/workflow/workflow-service");

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

  static async commitGroupBooking(req, res) {
    const tenantId = req.params.tenant;
    const user = req.user;

    console.log("Committing group booking for tenant:", tenantId);

    try {
      const groupBookingId = req.params.id;

      const groupBooking = await GroupBookingManager.getGroupBooking(
        tenantId,
        groupBookingId,
      );

      if (
        user &&
        (await PermissionsService._allowUpdate(
          groupBooking,
          user.id,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        ))
      ) {
        const result = await BookingService.commitGroupBooking(
          tenantId,
          groupBookingId,
        );

        if (!result.success) {
          return res.status(200).json({
            success: false,
            data: null,
            errors: result.errors,
          });
        }

        const updatedGroupBooking = await GroupBookingManager.getGroupBooking(
          tenantId,
          groupBookingId,
          true,
        );

        return res.status(200).json({
          success: true,
          data: updatedGroupBooking,
          errors: [],
        });
      } else {
        logger.error(
          { tenantId: tenantId, user: user.id },
          "User not allowed to commit group booking",
        );
        res.status(403).send({
          message: "User not allowed to commit group booking",
        });
      }
    } catch (error) {
      logger.error(
        { tenantId: tenantId, error: error.message },
        "Error committing group booking",
      );
      res.status(500).send({ message: error.message });
    }
  }

  static async rejectGroupBooking(req, res) {
    try {
      const tenantId = req.params.tenant;
      const user = req.user;
      const groupBookingId = req.params.id;
      const { reason } = req.body;

      const groupBooking = await GroupBookingManager.getGroupBooking(
        tenantId,
        groupBookingId,
      );

      if (
        user &&
        (await PermissionsService._allowUpdate(
          groupBooking,
          user.id,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        ))
      ) {
        const result = await BookingService.rejectGroupBooking(
          tenantId,
          groupBookingId,
          reason,
        );

        if (!result.success) {
          return res.status(200).json({
            success: false,
            data: null,
            errors: result.errors,
          });
        }

        const updatedGroupBooking = await GroupBookingManager.getGroupBooking(
          tenantId,
          groupBookingId,
          true,
        );

        return res.status(200).json({
          success: true,
          data: updatedGroupBooking,
          errors: [],
        });
      } else {
        logger.error(
          { tenantId: tenantId, user: user.id },
          "User not allowed to reject group booking",
        );
        res.status(403).send({
          message: "User not allowed to reject group booking",
        });
      }
    } catch (error) {
      res.status(500).send({ message: error.message });
    }
  }

  static async createGroupBookingReceipt(req, res) {
    try {
      const tenantId = req.params.tenant;
      const user = req.user;
      const groupBookingId = req.params.id;

      const groupBooking = await GroupBookingManager.getGroupBooking(
        tenantId,
        groupBookingId,
      );

      if (
        user &&
        (await PermissionsService._allowUpdate(
          groupBooking,
          user.id,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        ))
      ) {
        const result = await BookingService.createAggregatedReceipt(
          tenantId,
          groupBooking.bookingIds,
        );

        if (!result.success) {
          return res.status(200).json({
            success: false,
            data: null,
            errors: result.errors,
          });
        }

        const updatedGroupBooking = await GroupBookingManager.getGroupBooking(
          tenantId,
          groupBookingId,
          true,
        );

        return res.status(200).json({
          success: true,
          data: updatedGroupBooking,
          errors: [],
        });
      } else {
        logger.error(
          { tenantId: tenantId, user: user.id },
          "User not allowed to create group booking receipt",
        );
        res.status(403).send({
          message: "User not allowed to create group booking receipt",
        });
      }
    } catch (error) {
      res.status(500).send({ message: error.message });
    }
  }

  static async removeGroupBooking(req, res) {
    try {
      const tenantId = req.params.tenant;
      const user = req.user;
      const groupBookingId = req.params.id;

      const groupBooking = await GroupBookingManager.getGroupBooking(
        tenantId,
        groupBookingId,
      );
      if (
        user &&
        (await PermissionsService._allowUpdate(
          groupBooking,
          user.id,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        ))
      ) {
        for (const bookingId of groupBooking.bookingIds) {
          console.log("Deleting booking with ID:", bookingId);
          await BookingService.cancelBooking(tenantId, bookingId);
          await WorkflowService.removeTask(tenantId, bookingId);
        }
        await GroupBookingManager.deleteGroupBooking(tenantId, groupBookingId);
        res.status(200).send(groupBooking);
      } else {
        logger.error(
          { tenantId: tenantId, user: user.id },
          "User not allowed to remove group booking",
        );
        res.status(403).send({
          message: "User not allowed to remove group booking",
        });
      }
    } catch (error) {
      res.status(500).send({ message: error.message });
    }
  }
}

module.exports = { GroupBookingController };
