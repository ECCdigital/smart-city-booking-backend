const {
  BookableManager,
} = require("../../../commons/data-managers/bookable-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const {
  Booking,
  BOOKING_HOOK_TYPES,
} = require("../../../commons/entities/booking");
const { RolePermission } = require("../../../commons/entities/role");
const UserManager = require("../../../commons/data-managers/user-manager");
const bunyan = require("bunyan");
const ReceiptService = require("../../../commons/services/payment/receipt-service");
const BookingService = require("../../../commons/services/checkout/booking-service");
const WorkflowService = require("../../../commons/services/workflow/workflow-service");
const PermissionsService = require("../../../commons/services/permission-service");

const logger = bunyan.createLogger({
  name: "booking-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Web Controller for Bookings.
 */
class BookingController {
  static async _populate(bookings) {
    for (let booking of bookings) {
      booking._populated = {
        bookable: await BookableManager.getBookable(
          booking.bookableId,
          booking.tenantId,
        ),
        workflowStatus: await WorkflowService.getWorkflowStatus(
          booking.tenant,
          booking.id,
        ),
      };
    }
  }

  static anonymizeBooking(booking) {
    return {
      id: booking.id,
      tenantId: booking.tenantId,
      bookableIds: booking.bookableIds,
      timeBegin: booking.timeBegin,
      timeEnd: booking.timeEnd,
    };
  }

  /**
   * Get all bookings. If public-flag ist set, then all bookings can be received. Otherwise only bookings, the user is
   * allowed to read.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async getBookings(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const bookings = await BookingManager.getBookings(tenant);

      if (request.query.public === "true") {
        const anonymizedBookings = bookings.map((b) => {
          return BookingController.anonymizeBooking(b);
        });

        logger.info(
          `${tenant} -- sending ${anonymizedBookings.length} anonymized bookings to user ${user?.id}`,
        );
        response.status(200).send(anonymizedBookings);
      } else if (user) {
        if (request.query.populate === "true") {
          await BookingController._populate(bookings);
        }

        const allowedBookings = [];
        for (const booking of bookings) {
          if (
            user &&
            (await PermissionsService._allowRead(
              booking,
              user.id,
              tenant,
              RolePermission.MANAGE_BOOKINGS,
            ))
          ) {
            allowedBookings.push(booking);
          }
        }

        logger.info(
          `${tenant} -- sending ${allowedBookings.length} allowed bookings to user ${user?.id}`,
        );
        response.status(200).send(allowedBookings);
      } else {
        logger.warn(
          `${tenant} -- could not get bookings. User is not authenticated`,
        );
        response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get bookings");
    }
  }

  /**
   * Get all Bookings assigned to the current user.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async getAssignedBookings(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      //TODO: Check if user is authenticated
      const hasPermission = user.tenant === tenant;

      if (hasPermission) {
        const bookings = await BookingManager.getAssignedBookings(
          tenant,
          user.id,
        );

        if (request.query.populate === "true") {
          await BookingController._populate(bookings);
        }

        logger.info(
          `${tenant} -- sending ${bookings.length} assigned bookings to user ${user?.id}`,
        );
        response.status(200).send(bookings);
      } else {
        logger.warn(
          `${tenant} -- could not get assigned bookings. User is not authenticated`,
        );
        response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get assigned bookings");
    }
  }

  /**
   * Get all Bookings including those that have a relation to parent or child bookables.
   * IMPORTANT: User needs readAny-Permission to access this endpoint without public-flag.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async getRelatedBookings(request, response) {
    try {
      const user = request.user;
      const tenant = request.params.tenant;
      const bookableId = request.params.id;

      const includeRelatedBookings = request.query.related === "true";
      const includeParentBookings = request.query.parent === "true";

      let bookings = await BookingManager.getRelatedBookings(
        tenant,
        bookableId,
      );

      if (includeRelatedBookings) {
        let relatedBookables = await BookableManager.getRelatedBookables(
          bookableId,
          tenant,
        );

        for (let relatedBookable of relatedBookables) {
          let relatedBookings = await BookingManager.getRelatedBookings(
            tenant,
            relatedBookable.id,
          );

          bookings = bookings.concat(relatedBookings);
        }
      }

      if (includeParentBookings) {
        let parentBookables = await BookableManager.getParentBookables(
          bookableId,
          tenant,
        );

        for (let parentBookable of parentBookables) {
          let parentBookings = await BookingManager.getRelatedBookings(
            tenant,
            parentBookable.id,
          );

          bookings = bookings.concat(parentBookings);
        }
      }

      if (request.query.public === "true") {
        const anonymizedBookings = bookings.map((b) => {
          return {
            id: b.id,
            tenantId: b.tenantId,
            bookableId: b.bookableId,
            timeBegin: b.timeBegin,
            timeEnd: b.timeEnd,
          };
        });

        response.status(200).send(anonymizedBookings);
      } else if (user) {
        const hasPermission = await UserManager.hasPermission(
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
          "readAny",
        );

        if (hasPermission) {
          response.status(200).send(bookings);
        } else {
          response.sendStatus(403);
        }
      } else {
        response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get related bookings");
    }
  }

  /**
   * Get a single booking.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async getBooking(request, response) {
    try {
      const user = request.user;
      const tenantId = request.params.tenant;
      const id = request.params.id;

      if (id) {
        const booking = await BookingManager.getBooking(id, tenantId);

        const hasPermission =
          (await UserManager.hasPermission(
            user.id,
            tenantId,
            RolePermission.MANAGE_BOOKINGS,
            "readAny",
          )) || PermissionsService._isOwner(booking, user.id, tenantId);

        if (hasPermission) {
          await BookingController._populate([booking]);
          logger.info(
            `${tenantId} -- sending booking ${id} to user ${user?.id}`,
          );
          response.status(200).send(booking);
        } else {
          logger.warn(
            `${tenantId} -- could not get booking. User ${user?.id} is not authenticated`,
          );
          response.sendStatus(403);
        }
      } else {
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get booking");
    }
  }

  /**
   * Get the status of a booking.
   *
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async getBookingStatus(request, response) {
    try {
      const user = request.user;
      const tenantId = request.params.tenant;
      const id = request.params.id;

      if (id) {
        const bookingStatus = await BookingManager.getBookingStatus(
          tenantId,
          id,
        );

        logger.info(
          `${tenantId} -- sending booking status ${bookingStatus} for booking ${id} to user ${user?.id}`,
        );
        response.status(200).send(bookingStatus);
      } else {
        logger.warn(
          `${tenantId} -- could not get booking status. No booking ID provided`,
        );
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get booking status");
    }
  }

  /**
   * @obsolete Use createBooking or updateBooking instead.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async storeBooking(request, response) {
    const booking = new Booking(request.body);

    let isUpdate =
      !!(await BookingManager.getBooking(booking.id, booking.tenantId)) &&
      !!booking.id;

    if (isUpdate) {
      await BookingController.updateBooking(request, response);
    } else {
      await BookingController.createBooking(request, response);
    }
  }

  static async createBooking(request, response) {
    const user = request.user;
    const booking = new Booking(request.body);

    if (
      !(await PermissionsService._allowCreate(
        booking,
        user.id,
        booking.tenantId,
        RolePermission.MANAGE_BOOKINGS,
      ))
    ) {
      logger.warn(
        `${booking.tenantId} -- User ${user?.id} is not allowed to create booking.`,
      );
      return response.sendStatus(403);
    }

    try {
      const newBooking = await BookingService.createBooking(request, true);
      return response.status(200).send(newBooking);
    } catch (err) {
      logger.error(err);
      const statusCode = err.cause?.code === 400 ? 400 : 500;
      return response
        .status(statusCode)
        .send(err.message || "Could not create booking");
    }
  }

  static async updateBooking(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const booking = new Booking(request.body);

      if (
        await PermissionsService._allowUpdate(
          booking,
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
        )
      ) {
        await BookingService.updateBooking(tenant, booking);

        await WorkflowService.updateTask(
          tenant,
          booking.id,
          request.body._populated?.workflowStatus,
        );
        logger.info(
          `${tenant} -- updated booking ${booking.id} by user ${user?.id}`,
        );
        response.status(201).send(booking);
      } else {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to update booking.`,
        );
        response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not update booking");
    }
  }

  static async removeBooking(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const id = request.params.id;
      if (id) {
        const booking = await BookingManager.getBooking(id, tenant);

        if (
          await PermissionsService._allowDelete(
            booking,
            user.id,
            tenant,
            RolePermission.MANAGE_BOOKINGS,
          )
        ) {
          await BookingService.cancelBooking(tenant, id);
          await WorkflowService.removeTask(tenant, id);
          logger.info(`${tenant} -- removed booking ${id} by user ${user?.id}`);
          response.sendStatus(200);
        } else {
          logger.warn(
            `${tenant} -- User ${user?.id} is not allowed to remove booking.`,
          );
          response.sendStatus(403);
        }
      } else {
        logger.warn(
          `${tenant} -- could not remove booking. No booking ID provided`,
        );
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not remove booking");
    }
  }

  static async commitBooking(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const id = request.params.id;
      if (!id) {
        return response.sendStatus(400);
      }

      const booking = await BookingManager.getBooking(id, tenant);

      if (
        await PermissionsService._allowUpdate(
          booking,
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
        )
      ) {
        logger.info(
          `${tenant} -- committed booking ${booking.id} by user ${user?.id}`,
        );
        await BookingService.commitBooking(tenant, booking);
        return response.sendStatus(200);
      } else {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to commit booking.`,
        );
        return response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      if (!response.headersSent) {
        response.status(500).send("Could not commit booking");
      }
    }
  }

  static async rejectBooking(request, response) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;
      const id = request.params.id;
      const { reason } = request.body;
      if (!id) {
        return response.sendStatus(400);
      }

      const booking = await BookingManager.getBooking(id, tenantId);

      if (
        await PermissionsService._allowUpdate(
          booking,
          user.id,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        )
      ) {
        logger.info(
          `${tenantId} -- rejected booking ${booking.id} by user ${user?.id}`,
        );
        await BookingService.rejectBooking(tenantId, id, reason);
        return response.sendStatus(200);
      } else {
        logger.warn(
          `${tenantId} -- User ${user?.id} is not allowed to reject booking.`,
        );
        return response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      if (!response.headersSent) {
        response.status(500).send("Could not reject booking");
      }
    }
  }

  static async requestRejectBooking(request, response) {
    try {
      const tenant = request.params.tenant;
      const id = request.params.id;
      const reason = request.body.reason;
      if (!id) {
        return response.sendStatus(400);
      }

      await BookingService.requestRejectBooking(tenant, id, reason);

      response.sendStatus(201);
    } catch (err) {
      logger.error(err);
      if (!response.headersSent) {
        response.status(500).send("Could not reject booking");
      }
    }
  }

  static async releaseBookingHook(request, response) {
    try {
      const tenant = request.params.tenant;
      const id = request.params.id;
      const hookId = request.params.hookId;
      if (!id || !hookId) {
        return response.sendStatus(400);
      }

      const booking = await BookingManager.getBooking(id, tenant);

      if (!booking.hooks || booking.hooks.length === 0) {
        return response.sendStatus(404);
      }

      const hook = booking.hooks.find((h) => h.id === hookId);
      if (hook) {
        if (hook.type === BOOKING_HOOK_TYPES.REJECT) {
          const { reason } = hook.payload;
          await BookingService.rejectBooking(tenant, id, reason);
        } else {
          return response.sendStatus(400);
        }
      } else {
        return response.sendStatus(404);
      }

      response.sendStatus(200);
    } catch (err) {
      logger.error(err);
      if (!response.headersSent) {
        response.status(500).send("Could not reject booking");
      }
    }
  }

  static async getEventBookings(request, response) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;
      const eventId = request.params.id;

      const bookables = await BookableManager.getBookables(tenantId);
      const eventTickets = bookables.filter(
        (b) => b.type === "ticket" && b.eventId === eventId,
      );

      const bookings = await BookingManager.getBookings(tenantId);
      const eventBookings = bookings.filter((b) =>
        b.bookableIds.some((id) => eventTickets.some((t) => t.id === id)),
      );

      const allowedBookings = [];
      for (const booking of eventBookings) {
        if (
          user &&
          (await PermissionsService._allowRead(
            booking,
            user.id,
            tenantId,
            RolePermission.MANAGE_BOOKINGS,
          ))
        ) {
          allowedBookings.push(booking);
        }
      }

      logger.info(
        `${tenantId} -- sending ${allowedBookings.length} allowed event bookings to user ${user?.id}`,
      );
      response.status(200).send(allowedBookings);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get event bookings");
    }
  }

  static async getReceipt(request, response) {
    const {
      params: { tenant, id: bookingId, receiptId },
      user,
    } = request;

    try {
      if (!tenant || !bookingId || !receiptId) {
        logger.warn(`${tenant} -- Missing required parameters.`);
        return response.status(400).send("Missing required parameters.");
      }

      const booking = await BookingManager.getBooking(bookingId, tenant);

      const hasPermission =
        (await UserManager.hasPermission(
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
          "readAny",
        )) ||
        PermissionsService._isOwner(
          booking,
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
        );

      if (!hasPermission) {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to get receipt.`,
        );
        return response.sendStatus(403);
      }

      const receipt = await ReceiptService.getReceipt(tenant, receiptId);

      logger.info(
        `${tenant} -- sending receipt ${receiptId} to user ${user?.id}`,
      );
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename=${receiptId}`,
      );

      return response.status(200).send(receipt);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not get receipt");
    }
  }

  static async createReceipt(request, response) {
    try {
      const {
        params: { tenant, id: bookingId },
        user,
      } = request;

      if (!tenant || !bookingId) {
        logger.warn(`${tenant} -- Missing required parameters.`);
        return response.status(400).send("Missing required parameters.");
      }

      const booking = await BookingManager.getBooking(bookingId, tenant);

      const hasPermission =
        (await UserManager.hasPermission(
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
          "updateAny",
        )) ||
        PermissionsService._isOwner(
          booking,
          user.id,
          tenant,
          RolePermission.MANAGE_BOOKINGS,
        );

      if (!hasPermission) {
        logger.warn(
          `${tenant} -- User ${user?.id} is not allowed to create receipt.`,
        );
        return response.sendStatus(403);
      }

      await ReceiptService.createReceipt(tenant, bookingId);

      return response.sendStatus(200);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not create receipt");
    }
  }

  static async getPublicBookingStatus(request, response) {
    const {
      params: { tenant, id },
      query: { lastname },
    } = request;

    if (!tenant || !id || !lastname) {
      logger.warn(`${tenant} -- Missing required parameters.`);
      return response.status(400).send("Missing required parameters.");
    }

    try {
      const status = await BookingService.checkBookingStatus(
        id,
        lastname,
        tenant,
      );

      logger.info(`${tenant} -- sending public booking status to user`);
      return response.status(200).send(status);
    } catch (err) {
      logger.error(err);
      return response
        .status(err.code || 500)
        .send("Could not get public booking status");
    }
  }

  static async verifyBookingOwnership(request, response) {
    const {
      params: { tenant, id },
      query: { name },
    } = request;

    if (!tenant || !id || !name) {
      logger.warn(`${tenant} -- Missing required parameters.`);
      return response.status(400).send("Missing required parameters.");
    }

    try {
      const status = await BookingService.verifyBookingOwnership(
        tenant,
        id,
        name,
      );

      logger.info(`${tenant} -- sending booking ownership status to user`);
      if (status === true) {
        return response.sendStatus(200);
      } else {
        return response.sendStatus(401);
      }
    } catch (err) {
      logger.error(err);
      return response
        .status(err.code || 500)
        .send("Could not check booking ownership");
    }
  }
}

module.exports = { BookingController };
