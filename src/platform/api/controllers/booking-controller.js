const BookableManager = require("../../../commons/data-managers/bookable-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const { Booking } = require("../../../commons/entities/booking");
const { RolePermission } = require("../../../commons/entities/role");
const MailController = require("../../../commons/mail-service/mail-controller");
const UserManager = require("../../../commons/data-managers/user-manager");
const bunyan = require("bunyan");
const {
  createBooking,
} = require("../../../commons/services/checkout/booking-service");
const ReceiptService = require("../../../commons/services/receipt/receipt-service");

const logger = bunyan.createLogger({
  name: "booking-controller.js",
  level: process.env.LOG_LEVEL,
});

class BookingPermissions {
  static _isOwner(booking, userId, tenant) {
    return booking.assignedUserId === userId && booking.tenant === tenant;
  }

  static async _allowCreate(booking, userId, tenant) {
    return (
      tenant === booking.tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "create",
      ))
    );
  }

  static async _allowRead(booking, userId, tenant) {
    if (
      tenant === booking.tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "readAny",
      ))
    )
      return true;

    if (
      tenant === booking.tenant &&
      BookingPermissions._isOwner(booking, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "readOwn",
      ))
    )
      return true;

    return false;
  }

  static async _allowUpdate(booking, userId, tenant) {
    if (
      tenant === booking.tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "updateAny",
      ))
    )
      return true;

    if (
      BookingPermissions._isOwner(booking, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "updateOwn",
      ))
    )
      return true;

    return false;
  }

  static async _allowDelete(booking, userId, tenant) {
    if (
      tenant === booking.tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "deleteAny",
      ))
    )
      return true;

    if (
      tenant === booking.tenant &&
      BookingPermissions._isOwner(booking, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "deleteOwn",
      ))
    )
      return true;

    return false;
  }
}

/**
 * Web Controller for Bookings.
 */
class BookingController {
  static async _populate(bookings) {
    for (let booking of bookings) {
      booking._populated = {
        bookable: await BookableManager.getBookable(
          booking.bookableId,
          booking.tenant,
        ),
      };
    }
  }

  static anonymizeBooking(booking) {
    return {
      id: booking.id,
      tenant: booking.tenant,
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
            (await BookingPermissions._allowRead(booking, user.id, user.tenant))
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
            tenant: b.tenant,
            bookableId: b.bookableId,
            timeBegin: b.timeBegin,
            timeEnd: b.timeEnd,
          };
        });

        response.status(200).send(anonymizedBookings);
      } else if (user) {
        const hasPermission =
          user.tenant === tenant &&
          (await UserManager.hasPermission(
            user.id,
            user.tenant,
            RolePermission.MANAGE_BOOKINGS,
            "readAny",
          ));

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
          (user.tenant === tenantId &&
            (await UserManager.hasPermission(
              user.id,
              user.tenant,
              RolePermission.MANAGE_BOOKINGS,
              "readAny",
            ))) ||
          BookingPermissions._isOwner(booking, user.id, user.tenant);

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
    const booking = Object.assign(new Booking(), request.body);

    let isUpdate =
      !!(await BookingManager.getBooking(booking.id, booking.tenant)) &&
      !!booking.id;

    if (isUpdate) {
      await BookingController.updateBooking(request, response);
    } else {
      await BookingController.createBooking(request, response);
    }
  }

  static async createBooking(request, response) {
    const user = request.user;
    const booking = Object.assign(new Booking(), request.body);

    if (
      !(await BookingPermissions._allowCreate(booking, user.id, user.tenant))
    ) {
      logger.warn(
        `${booking.tenant} -- User ${user?.id} is not allowed to create booking.`,
      );
      return response.sendStatus(403);
    }

    try {
      const newBooking = await createBooking(request, true);
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
      const booking = Object.assign(new Booking(), request.body);

      if (
        await BookingPermissions._allowUpdate(booking, user.id, user.tenant)
      ) {
        await BookingManager.storeBooking(booking);
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
          await BookingPermissions._allowDelete(booking, user.id, user.tenant)
        ) {
          await BookingManager.removeBooking(id, tenant);
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
      if (id) {
        const booking = await BookingManager.getBooking(id, tenant);

        if (
          await BookingPermissions._allowUpdate(booking, user.id, user.tenant)
        ) {
          if (
            booking.isPayed === true ||
            !booking.priceEur ||
            booking.priceEur === 0
          ) {
            await MailController.sendFreeBookingConfirmation(
              booking.mail,
              booking.id,
              booking.tenant,
            );
            logger.info(
              `${tenant} -- booking ${id} committed by user ${user?.id} and sent free booking confirmation to ${booking.mail} `,
            );
            response.sendStatus(200);
          } else {
            await MailController.sendPaymentRequest(
              booking.mail,
              booking.id,
              booking.tenant,
            );
            logger.info(
              `${tenant} -- booking ${id} committed by user ${user?.id} and sent payment request to ${booking.mail} `,
            );
            response.sendStatus(200);
          }

          booking.isCommitted = true;
          await BookingManager.storeBooking(booking);
        } else {
          logger.warn(
            `${tenant} -- User ${user?.id} is not allowed to commit booking.`,
          );
          response.sendStatus(403);
        }
      } else {
        logger.warn(
          `${tenant} -- could not commit booking. No booking ID provided`,
        );
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not commit booking");
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
          (await BookingPermissions._allowRead(booking, user.id, user.tenant))
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
        (user.tenant === tenant &&
          (await UserManager.hasPermission(
            user.id,
            user.tenant,
            RolePermission.MANAGE_BOOKINGS,
            "readAny",
          ))) ||
        BookingPermissions._isOwner(booking, user.id, user.tenant);

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
        (user.tenant === tenant &&
          (await UserManager.hasPermission(
            user.id,
            user.tenant,
            RolePermission.MANAGE_BOOKINGS,
            "updateAny",
          ))) ||
        BookingPermissions._isOwner(booking, user.id, user.tenant);

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
}

module.exports = { BookingController, BookingPermissions };
