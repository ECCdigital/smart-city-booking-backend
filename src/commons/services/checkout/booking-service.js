const bunyan = require("bunyan");
const BookingManager = require("../../data-managers/booking-manager");
const MailController = require("../../mail-service/mail-controller");
const { v4: uuidV4 } = require("uuid");
const { getTenant } = require("../../data-managers/tenant-manager");
const {
  BundleCheckoutService,
  ManualBundleCheckoutService,
} = require("./bundle-checkout-service");
const ReceiptService = require("../payment/receipt-service");
const LockerService = require("../locker/locker-service");
const EventManager = require("../../data-managers/event-manager");
const { isEmail } = require("validator");
const { BOOKING_HOOK_TYPES } = require("../../entities/booking");

const logger = bunyan.createLogger({
  name: "checkout-controller.js",
  level: process.env.LOG_LEVEL,
});
class BookingService {
  /**
   * This is a static asynchronous method that creates a booking.
   *
   * @param {Object} request - The request object from the client.
   * @param {Boolean}  manualBooking - The manual booking object.
   *
   * @returns {Object} booking - The booking object that was created.
   *
   * @throws {Error} Will throw an error if the bookableItems array is empty or not provided.
   */
  static async createBooking(request, manualBooking = false) {
    const checkoutId = uuidV4();
    const tenantId = request.params.tenant;
    const simulate = request.query.simulate === "true";
    const user = request.user;
    const tenant = await getTenant(tenantId);

    const {
      timeBegin,
      timeEnd,
      bookableItems,
      couponCode,
      name,
      company,
      street,
      zipCode,
      location,
      mail,
      phone,
      comment,
      attachmentStatus,
      paymentProvider,
    } = request.body;

    logger.info(
      `${tenantId}, cid ${checkoutId} -- checkout request by user ${user?.id} with simulate=${simulate}`,
    );
    logger.debug(
      `${tenantId}, cid ${checkoutId} -- Checkout Details: timeBegin=${timeBegin}, timeEnd=${timeEnd}, bookableItems=${bookableItems}, couponCode=${couponCode}, name=${name}, company=${company}, street=${street}, zipCode=${zipCode}, location=${location}, email=${mail}, phone=${phone}, comment=${comment}`,
    );

    if (!bookableItems || bookableItems.length === 0) {
      logger.warn(
        `${tenantId}, cid ${checkoutId} -- checkout stopped. Missing parameters`,
      );

      throw new Error("Missing parameters", { cause: { code: 400 } });
    }

    let bundleCheckoutService;

    if (manualBooking) {
      bundleCheckoutService = new ManualBundleCheckoutService(
        user?.id,
        tenantId,
        timeBegin,
        timeEnd,
        null,
        bookableItems,
        couponCode,
        name,
        company,
        street,
        zipCode,
        location,
        mail,
        phone,
        comment,
        Boolean(request.body.isCommitted),
        Boolean(request.body.isPayed),
        Boolean(request.body.isRejected),
        attachmentStatus,
        paymentProvider,
      );
    } else {
      bundleCheckoutService = new BundleCheckoutService(
        user?.id,
        tenantId,
        timeBegin,
        timeEnd,
        null,
        bookableItems,
        couponCode,
        name,
        company,
        street,
        zipCode,
        location,
        mail,
        phone,
        comment,
        attachmentStatus,
        paymentProvider,
      );
    }

    const booking = await bundleCheckoutService.prepareBooking();

    logger.debug(
      `${tenantId}, cid ${checkoutId} -- Booking prepared: ${JSON.stringify(
        booking,
      )}`,
    );

    if (simulate === false) {
      await BookingManager.storeBooking(booking);

      logger.info(
        `${tenantId}, cid ${checkoutId} -- Booking ${booking.id} stored by user ${user?.id}`,
      );
      if (!booking.isCommitted) {
        try {
          await MailController.sendBookingRequestConfirmation(
            booking.mail,
            booking.id,
            booking.tenantId,
          );
        } catch (err) {
          logger.error(err);
        }
      }
      if (booking.isCommitted && booking.isPayed) {
        let attachments = [];
        try {
          if (booking.priceEur > 0) {
            const pdfData = await ReceiptService.createReceipt(
              tenantId,
              booking.id,
            );

            attachments = [
              {
                filename: pdfData.name,
                content: pdfData.buffer,
                contentType: "application/pdf",
              },
            ];
          }
        } catch (err) {
          logger.error(err);
        }

        try {
          await MailController.sendBookingConfirmation(
            booking.mail,
            booking.id,
            booking.tenantId,
            attachments,
          );
        } catch (err) {
          logger.error(err);
        }

        try {
          const lockerServiceInstance = LockerService.getInstance();
          await lockerServiceInstance.handleCreate(
            booking.tenantId,
            booking.id,
          );
        } catch (err) {
          logger.error(err);
        }

        const isTicketBooking = bookableItems.some(isTicket);

        if (isTicketBooking) {
          const eventIds = bookableItems.map(getEventForTicket);
          await sendEmailToOrganizer(eventIds, tenantId, booking);
        }
      }

      try {
        await MailController.sendIncomingBooking(
          tenant.mail,
          booking.id,
          booking.tenantId,
        );
      } catch (err) {
        logger.error(err);
      }
    } else {
      logger.info(`${tenantId}, cid ${checkoutId} -- Simulated booking`);
    }
    return booking;
  }

  static async cancelBooking(tenantId, bookingId) {
    try {
      const booking = await BookingManager.getBooking(bookingId, tenantId);
      if (!booking) {
        throw new Error("Booking not found");
      }

      const lockerServiceInstance = LockerService.getInstance();
      await lockerServiceInstance.handleCancel(booking.tenantId, booking.id);
      await BookingManager.removeBooking(booking.id, booking.tenantId);
    } catch (error) {
      throw new Error(`Error cancelling booking: ${error.message}`);
    }
  }

  static async updateBooking(tenantId, updatedBooking) {
    const oldBooking = await BookingManager.getBooking(
      updatedBooking.id,
      tenantId,
    );
    try {
      const bundleCheckoutService = new ManualBundleCheckoutService(
        updatedBooking.assignedUserId,
        tenantId,
        updatedBooking.timeBegin,
        updatedBooking.timeEnd,
        oldBooking.timeCreated,
        updatedBooking.bookableItems,
        updatedBooking.couponCode,
        updatedBooking.name,
        updatedBooking.company,
        updatedBooking.street,
        updatedBooking.zipCode,
        updatedBooking.location,
        updatedBooking.mail,
        updatedBooking.phone,
        updatedBooking.comment,
        Boolean(updatedBooking.isCommitted),
        Boolean(updatedBooking.isPayed),
        Boolean(updatedBooking.isRejected),
        updatedBooking.attachmentStatus,
        updatedBooking.paymentProvider,
        updatedBooking.paymentMethod,
      );

      const booking = await bundleCheckoutService.prepareBooking({
        keepExistingId: true,
        existingId: oldBooking.id,
      });

      await BookingManager.storeBooking(booking);

      if (!oldBooking.isCommitted && booking.isCommitted) {
        await BookingService.commitBooking(tenantId, booking);
      }

      const lockerServiceInstance = LockerService.getInstance();
      await lockerServiceInstance.handleUpdate(
        updatedBooking.tenantId,
        oldBooking,
        booking,
      );
    } catch (error) {
      await BookingManager.storeBooking(oldBooking);
      throw new Error(`Error updating booking: ${error.message}`);
    }

    return BookingManager.getBooking(updatedBooking.id, tenantId);
  }

  static async commitBooking(tenant, booking) {
    try {
      const originBooking = await BookingManager.getBooking(booking.id, tenant);
      originBooking.isCommitted = true;
      originBooking.isRejected = false;
      await BookingManager.storeBooking(originBooking);
      if (
        originBooking.isPayed === true ||
        !originBooking.priceEur ||
        originBooking.priceEur === 0
      ) {
        await MailController.sendFreeBookingConfirmation(
          originBooking.mail,
          originBooking.id,
          originBooking.tenantId,
        );
        logger.info(
          `${tenant} -- booking ${originBooking.id} committed and sent free booking confirmation to ${originBooking.mail}`,
        );
      } else {
        await MailController.sendPaymentRequest(
          originBooking.mail,
          originBooking.id,
          originBooking.tenantId,
        );
        logger.info(
          `${tenant} -- booking ${originBooking.id} committed and sent payment request to ${originBooking.mail}`,
        );
      }
      const bookableItems = originBooking.bookableItems;
      const isTicketBooking = bookableItems.some(isTicket);

      if (isTicketBooking) {
        const eventIds = bookableItems.map(getEventForTicket);
        await sendEmailToOrganizer(eventIds, tenant, originBooking);
      }
    } catch (error) {
      throw new Error(`Error committing booking: ${error.message}`);
    }
  }

  static async rejectBooking(tenantId, bookingId, reason = "", hookId = null) {
    try {
      const booking = await BookingManager.getBooking(bookingId, tenantId);

      booking.isRejected = true;

      if (hookId) {
        booking.removeHook(hookId);
      }

      await BookingManager.storeBooking(booking);

      await MailController.sendBookingRejection(
        booking.mail,
        booking.id,
        booking.tenantId,
        reason,
      );
      logger.info(
        `${tenantId} -- booking ${booking.id} rejected and sent booking rejection to ${booking.mail}`,
      );
    } catch (error) {
      throw new Error(`Error rejecting booking: ${error.message}`);
    }
  }

  static async requestRejectBooking(tenant, bookingId, reason = "") {
    try {
      const booking = await BookingManager.getBooking(bookingId, tenant);

      const hook = booking.addHook(BOOKING_HOOK_TYPES.REJECT, {
        reason: reason,
      });

      await BookingManager.storeBooking(booking);

      await MailController.sendVerifyBookingRejection(
        booking.mail,
        booking.id,
        booking.tenantId,
        hook.id,
        reason,
      );
      logger.info(
        `${tenant} -- booking ${booking.id} rejection requested and sent booking reject verification to ${booking.mail}`,
      );
    } catch (error) {
      throw new Error(`Error requesting booking rejection: ${error.message}`);
    }
  }

  static async checkBookingStatus(bookingId, name, tenantId) {
    const tenant = await getTenant(tenantId);

    if (!tenant.enablePublicStatusView) {
      throw { message: "Public status view disabled ", code: 405 };
    }

    const booking = await BookingManager.getBooking(bookingId, tenantId);

    if (!booking.id) {
      throw { message: "Booking not found", code: 404 };
    }

    if (booking.name.toLowerCase() !== name.toLowerCase()) {
      throw { message: "Missmatch", code: 401 };
    }

    const leadingBookableItem = booking.bookableItems[0]._bookableUsed;

    let valid;

    if (booking.timeEnd && booking.timeEnd) {
      if (booking.timeEnd < new Date()) {
        valid = "expired";
      } else if (booking.timeBegin > new Date()) {
        valid = "pending";
      } else {
        valid = "active";
      }
    }

    return {
      bookingId: booking.id,
      title: leadingBookableItem.title,
      name: booking.name,
      status: {
        paymentStatus: booking.isPayed ? "paid" : "pending",
        bookingStatus: booking.isCommitted ? "confirmed" : "pending",
        activeStatus: valid,
      },
      timeBegin: booking.timeBegin,
      timeEnd: booking.timeEnd,
      timeCreated: booking.timeCreated,
      comment: booking.comment,
    };
  }

  static async verifyBookingOwnership(tenantId, bookingId, name) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);

    if (!booking.id) {
      throw { message: "Booking not found", code: 404 };
    }

    return booking.name.toLowerCase() === name.toLowerCase();
  }
}

module.exports = BookingService;

function isTicket(bookableItem) {
  if (!bookableItem?._bookableUsed) {
    return false;
  }
  return bookableItem._bookableUsed.type === "ticket";
}

function getEventForTicket(bookableItem) {
  return bookableItem._bookableUsed.eventId || null;
}

async function sendEmailToOrganizer(eventIds, tenantId, booking) {
  try {
    const uniqueEventIds = [...new Set(eventIds)];

    const events = await Promise.all(
      uniqueEventIds.map((eventId) => EventManager.getEvent(eventId, tenantId)),
    );

    const organizerMails = events
      .map((event) => event.eventOrganizer?.contactPersonEmailAddress)
      .filter((email) => isEmail(email));
    const uniqueOrganizerMails = [...new Set(organizerMails)];

    if (uniqueOrganizerMails.length === 0) {
      logger.warn(`No organizer found for booking: ${booking.id}`);
      return;
    }

    const emailPromises = uniqueOrganizerMails.map(async (organizerMail) => {
      try {
        await MailController.sendNewBooking(
          organizerMail,
          booking.id,
          booking.tenantId,
        );
        logger.info(
          `Successfully send mail to organizer ${organizerMail} for booking ${booking.id}.`,
        );
      } catch (err) {
        logger.error(
          `Error while sending mail to organizer ${organizerMail} for booking ${booking.id}: ${err.message}`,
        );
      }
    });

    await Promise.all(emailPromises);
  } catch (err) {
    logger.error(
      `Error when retrieving events or sending mails: ${err.message}`,
    );
  }
}
