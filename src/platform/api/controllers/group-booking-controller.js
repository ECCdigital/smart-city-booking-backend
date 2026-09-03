const GroupBookingManager = require("../../../commons/data-managers/group-booking-manager");
const bunyan = require("bunyan");
const PermissionsService = require("../../../commons/services/permission-service");
const { RolePermission } = require("../../../commons/entities/role/role");
const BookingService = require("../../../commons/services/checkout/booking-service");
const WorkflowService = require("../../../commons/services/workflow/workflow-service");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const MailController = require("../../../commons/mail-service/mail-controller");
const {
  CancellationRefundService,
} = require("../../../commons/services/payment/cancellation-refund-service");
const {
  issue: issueDocument,
  mailAttachments,
} = require("../../../commons/services/documents/document-issuance");
const {
  groupBookingLifecycle,
  LifecycleError,
  TRANSITION,
  TRIGGER,
} = require("../../../commons/services/booking-lifecycle");
const {
  BaseError,
  ConflictError,
  NotFoundError,
} = require("../../../errors/BaseError");

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

  static async updateGroupBooking(req, res) {
    const tenantId = req.params.tenant;
    const user = req.user;

    try {
      const groupBookingId = req.params.id;
      const { updateData } = req.body;

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
        const updatedGroupBooking =
          await GroupBookingManager.updateGroupBooking(
            tenantId,
            groupBookingId,
            updateData,
          );

        return res.status(200).send(updatedGroupBooking);
      } else {
        logger.error(
          { tenantId: tenantId, user: user.id },
          "User not allowed to update group booking",
        );
        res.status(403).send({
          message: "User not allowed to update group booking",
        });
      }
    } catch (error) {
      logger.error(
        { tenantId: tenantId, error: error.message },
        "Error updating group booking",
      );
      res.status(500).send({ message: error.message });
    }
  }

  /**
   * The answer to an error of a group transition: the lifecycle's guard -
   * the members are not in the state the transition needs, differ in
   * state, or a second transition raced this one (409) - and a missing
   * group or member (404) with their status; an aborted transition as the
   * code of before (spec part 1, 4.3); everything else the plain 500.
   */
  static _answerTransitionError(err, res, code, tenantId) {
    const error =
      err instanceof LifecycleError
        ? new BaseError(code, 500, { message: err.message })
        : err;
    logger.error({ tenantId, error: error.message }, code);
    if (res.headersSent) {
      return;
    }
    if (error instanceof BaseError && error.statusCode < 500) {
      return res.status(error.statusCode).json(error.toJSON());
    }
    res.status(500).send({ message: error.message });
  }

  /**
   * The group and its members, populated, or the 404 answered.
   */
  static async _loadGroup(req, res) {
    const groupBooking = await GroupBookingManager.getGroupBooking(
      req.params.tenant,
      req.params.id,
      true,
    );
    if (!groupBooking) {
      const error = new NotFoundError("group_booking_not_found", {
        groupBookingId: req.params.id,
      });
      res.status(error.statusCode).json(error.toJSON());
      return null;
    }
    return groupBooking;
  }

  static async _allowed(groupBooking, user, tenantId) {
    return (
      user &&
      (await PermissionsService._allowUpdate(
        groupBooking,
        user.id,
        tenantId,
        RolePermission.MANAGE_BOOKINGS,
      ))
    );
  }

  /**
   * The confirmation of a group: the consistency checks of before with
   * their `{ success: false, errors }` answer, then the transition
   * `confirm` of the group lifecycle as the administration.
   */
  static async commitGroupBooking(req, res) {
    const tenantId = req.params.tenant;
    const user = req.user;

    try {
      const groupBookingId = req.params.id;
      const groupBooking = await GroupBookingController._loadGroup(req, res);
      if (!groupBooking) {
        return;
      }

      if (await GroupBookingController._allowed(groupBooking, user, tenantId)) {
        const errors = BookingService.groupTransitionErrors(
          TRANSITION.CONFIRM,
          groupBooking.bookings,
        );
        if (errors.length > 0) {
          logger.error(
            `${tenantId} -- group-booking ${groupBookingId} cannot be committed: ${JSON.stringify(errors)}`,
          );
          return res.status(200).json({
            success: false,
            data: null,
            errors,
          });
        }

        await groupBookingLifecycle.confirm(tenantId, groupBookingId, {
          trigger: TRIGGER.ADMIN,
        });

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
          { tenantId: tenantId, user: user?.id },
          "User not allowed to commit group booking",
        );
        res.status(403).send({
          message: "User not allowed to commit group booking",
        });
      }
    } catch (error) {
      GroupBookingController._answerTransitionError(
        error,
        res,
        "booking_commit_failed",
        tenantId,
      );
    }
  }

  /**
   * The payment of a group: the transition `pay` of the group lifecycle as
   * the administration.
   */
  static async payGroupBooking(req, res) {
    const tenantId = req.params.tenant;
    try {
      const user = req.user;
      const groupBookingId = req.params.id;
      const { paymentMethod, timePaid } = req.body;

      const groupBooking = await GroupBookingController._loadGroup(req, res);
      if (!groupBooking) {
        return;
      }

      if (await GroupBookingController._allowed(groupBooking, user, tenantId)) {
        await groupBookingLifecycle.pay(tenantId, groupBookingId, {
          trigger: TRIGGER.ADMIN,
          paymentMethod,
          timePaid,
        });

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
          { tenantId: tenantId, user: user?.id },
          "User not allowed to pay group booking",
        );
        res.status(403).send({
          message: "User not allowed to pay group booking",
        });
      }
    } catch (error) {
      GroupBookingController._answerTransitionError(
        error,
        res,
        "set_aggregated_booking_payed_failed",
        tenantId,
      );
    }
  }

  static async getCancellationRefundPreview(req, res) {
    try {
      const tenantId = req.params.tenant;
      const groupBookingId = req.params.id;
      const user = req.user;
      const groupBooking = await GroupBookingManager.getGroupBooking(
        tenantId,
        groupBookingId,
      );

      if (!groupBooking) {
        return res.sendStatus(404);
      }

      const hasPermission = await PermissionsService._allowUpdate(
        groupBooking,
        user.id,
        tenantId,
        RolePermission.MANAGE_BOOKINGS,
      );
      if (!hasPermission) {
        return res.sendStatus(403);
      }

      const preview = await BookingService.getGroupCancellationRefundPreview(
        tenantId,
        groupBookingId,
      );
      return res.status(200).send(preview);
    } catch (error) {
      logger.error(error);
      return res
        .status(error.statusCode || 500)
        .send(error.message || "Could not calculate cancellation refund");
    }
  }

  /**
   * The cancellation of a group: the consistency checks of before with
   * their `{ success: false, errors }` answer, then the transition `cancel`
   * of the group lifecycle as the administration, with the refund
   * percentage and the bank details of the form; `skipCancellation` is
   * the form's word for a cancellation without its document.
   */
  static async rejectGroupBooking(req, res) {
    const tenantId = req.params.tenant;
    try {
      const user = req.user;
      const groupBookingId = req.params.id;
      const { reason, skipCancellation, bankDetails, refundPercentage } =
        req.body || {};
      if (refundPercentage !== undefined) {
        try {
          CancellationRefundService.validateRefundPercentage(refundPercentage);
        } catch (error) {
          return res.status(400).send(error.code);
        }
      }

      const groupBooking = await GroupBookingController._loadGroup(req, res);
      if (!groupBooking) {
        return;
      }

      if (await GroupBookingController._allowed(groupBooking, user, tenantId)) {
        const errors = BookingService.groupTransitionErrors(
          TRANSITION.CANCEL,
          groupBooking.bookings,
        );
        if (errors.length > 0) {
          logger.error(
            `${tenantId} -- group-booking ${groupBookingId} cannot be rejected: ${JSON.stringify(errors)}`,
          );
          return res.status(200).json({
            success: false,
            data: null,
            errors,
          });
        }

        await groupBookingLifecycle.cancel(tenantId, groupBookingId, {
          trigger: TRIGGER.ADMIN,
          reason,
          bankDetails: bankDetails || null,
          refundPercentage,
          cancelledByUserId: user.id,
          withDocument: !skipCancellation,
        });

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
          { tenantId: tenantId, user: user?.id },
          "User not allowed to reject group booking",
        );
        res.status(403).send({
          message: "User not allowed to reject group booking",
        });
      }
    } catch (error) {
      GroupBookingController._answerTransitionError(
        error,
        res,
        "booking_rejection_failed",
        tenantId,
      );
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
        true,
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
        const errors = BookingService.reprintErrors(
          "receipt",
          groupBooking.bookings,
        );
        if (errors.length > 0) {
          logger.error(
            `${tenantId} -- group-booking ${groupBookingId} cannot get a receipt: ${JSON.stringify(errors)}`,
          );
          return res.status(200).json({ success: false, data: null, errors });
        }

        // A reprint is a further revision of the one aggregated receipt,
        // attached to every member; nothing is mailed.
        await issueDocument({
          tenantId,
          bookingIds: groupBooking.bookingIds,
          type: "receipt",
          groupBookingId,
        });

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

  static async createGroupBookingInvoice(req, res) {
    try {
      const tenantId = req.params.tenant;
      const user = req.user;
      const groupBookingId = req.params.id;
      const shouldSendEmail = req.query.sendEmail !== "false";

      const groupBooking = await GroupBookingManager.getGroupBooking(
        tenantId,
        groupBookingId,
        true,
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
        const invoiceApp = await TenantManager.getTenantApp(
          tenantId,
          "invoice",
        );
        if (!invoiceApp || !invoiceApp.active) {
          return res.status(400).send({
            message: "Invoice app not found or inactive.",
          });
        }

        const errors = BookingService.reprintErrors(
          "invoice",
          groupBooking.bookings,
        );
        if (errors.length > 0) {
          logger.error(
            `${tenantId} -- group-booking ${groupBookingId} cannot get an invoice: ${JSON.stringify(errors)}`,
          );
          return res.status(200).json({ success: false, data: null, errors });
        }

        const { file } = await issueDocument({
          tenantId,
          bookingIds: groupBooking.bookingIds,
          type: "invoice",
          groupBookingId,
        });

        if (shouldSendEmail) {
          try {
            await MailController.sendInvoice(
              groupBooking.bookings[0].mail,
              groupBooking.bookingIds,
              tenantId,
              mailAttachments(file),
              true,
            );
          } catch (err) {
            logger.error(
              "Error while sending aggregated invoice:",
              groupBookingId,
              err,
            );
          }
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
          "User not allowed to create group booking invoice",
        );
        res.status(403).send({
          message: "User not allowed to create group booking invoice",
        });
      }
    } catch (error) {
      res.status(500).send({ message: error.message });
    }
  }

  /**
   * Reprints the aggregated cancellation document of a cancelled group as a
   * further revision, from the refund audits the cancellation left at the
   * members. Same right as the receipt reprint; a group with a member that
   * has no cancellation answers 409 `not_cancelled`. Nothing is mailed.
   */
  static async createGroupBookingCancellationReceipt(req, res) {
    try {
      const tenantId = req.params.tenant;
      const user = req.user;
      const groupBookingId = req.params.id;

      const groupBooking = await GroupBookingManager.getGroupBooking(
        tenantId,
        groupBookingId,
        true,
      );
      if (!groupBooking) {
        return res.status(404).send({ message: "Group booking not found." });
      }

      if (
        !user ||
        !(await PermissionsService._allowUpdate(
          groupBooking,
          user.id,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        ))
      ) {
        logger.error(
          { tenantId: tenantId, user: user?.id },
          "User not allowed to create group booking cancellation receipt",
        );
        return res.status(403).send({
          message:
            "User not allowed to create group booking cancellation receipt",
        });
      }

      const bookings = groupBooking.bookings;
      const notCancelled = bookings.find(
        (booking) => !booking.cancellationRefund,
      );
      if (notCancelled) {
        const error = new ConflictError("not_cancelled", {
          groupBookingId,
          bookingId: notCancelled.id,
        });
        return res.status(error.statusCode).json(error.toJSON());
      }

      await issueDocument({
        tenantId,
        bookingIds: groupBooking.bookingIds,
        type: "cancellation",
        groupBookingId,
        options: {
          alreadyPaid: groupBooking.areSomeBookingsPaid(),
          cancellationReason: bookings[0].rejectionReason,
          refundCalculations: bookings.map((booking) => ({
            bookingId: booking.id,
            ...booking.cancellationRefund,
          })),
        },
      });

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
    } catch (error) {
      logger.error(
        { error: error.message },
        "Error creating group booking cancellation receipt",
      );
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
