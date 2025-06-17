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
const WorkflowManager = require("../../data-managers/workflow-manager");
const WorkflowService = require("../workflow/workflow-service");
const { BookableManager } = require("../../data-managers/bookable-manager");

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

    async function validateMandatoryAddons(bookableItems) {
      const bookableIds = bookableItems.map((item) => item.bookableId);

      const bookables = await Promise.all(
        bookableIds.map((id) => BookableManager.getBookable(id, tenantId)),
      );

      const bookableMap = new Map();
      for (let i = 0; i < bookableIds.length; i++) {
        bookableMap.set(bookableIds[i], bookables[i]);
      }

      const mandatoryAddons = [];
      for (const item of bookableItems) {
        const bookable = bookableMap.get(item.bookableId);
        if (bookable && Array.isArray(bookable.checkoutBookableIds)) {
          for (const addon of bookable.checkoutBookableIds) {
            if (addon.mandatory) {
              mandatoryAddons.push({
                bookableId: addon.bookableId,
                amount: item.amount,
              });
            }
          }
        }
      }

      const filteredAddons = [];
      for (const mandatoryAddon of mandatoryAddons) {
        const existingAddon = bookableItems.find(
          (item) => item.bookableId === mandatoryAddon.bookableId,
        );

        if (existingAddon) {
          if (existingAddon.amount !== mandatoryAddon.amount) {
            existingAddon.amount = mandatoryAddon.amount;
            filteredAddons.push(existingAddon);
          }
        } else {
          filteredAddons.push({
            bookableId: mandatoryAddon.bookableId,
            amount: mandatoryAddon.amount,
          });
        }
      }

      return filteredAddons;
    }

    let bundleCheckoutService;

    if (manualBooking) {
      bundleCheckoutService = new ManualBundleCheckoutService({
        user: user?.id,
        tenant: tenantId,
        timeBegin,
        timeEnd,
        bookableItems,
        couponCode,
        name,
        company,
        street,
        zipCode,
        location,
        email: mail,
        phone,
        comment,
        isCommit: Boolean(request.body.isCommitted),
        isPayed: Boolean(request.body.isPayed),
        isRejected: Boolean(request.body.isRejected),
        attachmentStatus,
        paymentProvider,
      });
    } else {
      const filteredAddons = await validateMandatoryAddons(bookableItems);
      const filteredBookableItems = bookableItems.concat(filteredAddons);

      bundleCheckoutService = new BundleCheckoutService({
        user: user?.id,
        tenant: tenantId,
        timeBegin,
        timeEnd,
        bookableItems: filteredBookableItems,
        couponCode,
        name,
        company,
        street,
        zipCode,
        location,
        email: mail,
        phone,
        comment,
        attachmentStatus,
        paymentProvider,
      });
    }

    const booking = await bundleCheckoutService.prepareBooking();

    logger.debug(
      `${tenantId}, cid ${checkoutId} -- Booking prepared: ${JSON.stringify(
        booking,
      )}`,
    );

    if (simulate === false) {
      await BookingManager.storeBooking(booking);
      const lockerServiceInstance = LockerService.getInstance();
      if (booking.lockerInfo) {
        for (const locker of booking.lockerInfo) {
          await LockerService.freeReservedLocker(
            booking.tenantId,
            locker.id,
            locker.lockerSystem,
            booking.timeBegin,
            booking.timeEnd,
          );
        }
      }

      const workflow = await WorkflowManager.getWorkflow(tenantId);
      if (workflow && workflow.active && workflow.defaultState) {
        await WorkflowService.updateTask(
          tenantId,
          booking.id,
          workflow.defaultState,
          0,
        );
      }

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
          await lockerServiceInstance.handleCreate(
            booking.tenantId,
            booking.id,
          );
        } catch (err) {
          logger.error(err);
        }

        const isTicketBooking = bookableItems.some(isTicket);

        if (isTicketBooking) {
          const eventIds = bookableItems
            .map(getEventForTicket)
            .filter((id) => id !== null && id !== undefined);
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

  static async removeBooking(tenantId, bookingId) {
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
      const bundleCheckoutService = new ManualBundleCheckoutService({
        user: updatedBooking.assignedUserId,
        tenant: tenantId,
        timeBegin: updatedBooking.timeBegin,
        timeEnd: updatedBooking.timeEnd,
        timeCreated: oldBooking.timeCreated,
        bookableItems: updatedBooking.bookableItems,
        couponCode: updatedBooking.couponCode,
        name: updatedBooking.name,
        company: updatedBooking.company,
        street: updatedBooking.street,
        zipCode: updatedBooking.zipCode,
        location: updatedBooking.location,
        email: updatedBooking.mail,
        phone: updatedBooking.phone,
        comment: updatedBooking.comment,
        isCommit: Boolean(updatedBooking.isCommitted),
        isPayed: Boolean(updatedBooking.isPayed),
        isRejected: Boolean(updatedBooking.isRejected),
        attachmentStatus: updatedBooking.attachmentStatus,
        paymentProvider: updatedBooking.paymentProvider,
        paymentMethod: updatedBooking.paymentMethod,
        attachments: oldBooking.attachments,
        lockerInfo: oldBooking.lockerInfo,
      });

      const booking = await bundleCheckoutService.prepareBooking({
        keepExistingId: true,
        existingId: oldBooking.id,
      });

      await BookingManager.storeBooking(booking);

      if (!oldBooking.isCommitted && booking.isCommitted) {
        await BookingService.commitBooking(tenantId, booking);
      } else if (booking.isCommitted && booking.isPayed) {
        const lockerServiceInstance = LockerService.getInstance();
        await lockerServiceInstance.handleUpdate(
          updatedBooking.tenantId,
          oldBooking,
          booking,
        );
      }
    } catch (error) {
      await BookingManager.storeBooking(oldBooking);
      throw new Error(`Error updating booking: ${error.message}`);
    }

    return BookingManager.getBooking(updatedBooking.id, tenantId);
  }

  static async commitBooking(tenantId, booking) {
    try {
      const originBooking = await BookingManager.getBooking(
        booking.id,
        tenantId,
      );

      if (originBooking.isRejected) {
        const bundleCheckoutService = new ManualBundleCheckoutService({
          user: originBooking.assignedUserId,
          tenant: tenantId,
          timeBegin: originBooking.timeBegin,
          timeEnd: originBooking.timeEnd,
          timeCreated: originBooking.timeCreated,
          bookableItems: originBooking.bookableItems,
          couponCode: originBooking.couponCode,
          name: originBooking.name,
          company: originBooking.company,
          street: originBooking.street,
          zipCode: originBooking.zipCode,
          location: originBooking.location,
          email: originBooking.mail,
          phone: originBooking.phone,
          comment: originBooking.comment,
          isCommit: Boolean(true),
          isPayed: Boolean(originBooking.isPayed),
          isRejected: Boolean(false),
          attachmentStatus: originBooking.attachmentStatus,
          paymentProvider: originBooking.paymentProvider,
          paymentMethod: originBooking.paymentMethod,
          attachments: originBooking.attachments,
          lockerInfo: originBooking.lockerInfo,
        });
        const booking = await bundleCheckoutService.prepareBooking({
          keepExistingId: true,
          existingId: originBooking.id,
        });

        await BookingManager.storeBooking(booking);
      } else {
        originBooking.isCommitted = true;
        originBooking.isRejected = false;
        await BookingManager.storeBooking(originBooking);
      }

      const updatedBooking = await BookingManager.getBooking(
        booking.id,
        tenantId,
      );

      if (
        updatedBooking.isPayed === true ||
        !updatedBooking.priceEur ||
        updatedBooking.priceEur === 0
      ) {
        const lockerServiceInstance = LockerService.getInstance();
        await lockerServiceInstance.handleUpdate(
          originBooking.tenantId,
          originBooking,
          updatedBooking,
        );

        await MailController.sendFreeBookingConfirmation(
          updatedBooking.mail,
          updatedBooking.id,
          updatedBooking.tenantId,
        );
        logger.info(
          `${tenantId} -- booking ${updatedBooking.id} committed and sent free booking confirmation to ${updatedBooking.mail}`,
        );
      } else {
        await MailController.sendPaymentRequest(
          updatedBooking.mail,
          updatedBooking.id,
          updatedBooking.tenantId,
        );
        logger.info(
          `${tenantId} -- booking ${updatedBooking.id} committed and sent payment request to ${updatedBooking.mail}`,
        );
      }
      const bookableItems = updatedBooking.bookableItems;
      const isTicketBooking = bookableItems.some(isTicket);

      if (isTicketBooking) {
        const eventIds = bookableItems
          .map(getEventForTicket)
          .filter((id) => id !== null && id !== undefined);
        if (eventIds.length > 0) {
          await sendEmailToOrganizer(eventIds, tenantId, updatedBooking);
        }
      }
    } catch (error) {
      throw new Error(`Error committing booking: ${error.message}`);
    }
  }

  static async setBookingPayed(tenantId, bookingId) {
    try {
      const booking = await BookingManager.getBooking(bookingId, tenantId);
      booking.isPayed = true;
      await BookingManager.storeBooking(booking);
      logger.info(
        `${tenantId} -- booking ${booking.id} set to payed and sent payment confirmation to ${booking.mail}`,
      );
    } catch (error) {
      throw new Error(`Error setting booking to payed: ${error.message}`);
    }
  }

  static async rejectBooking(tenantId, bookingId, reason = "", hookId = null) {
    try {
      const booking = await BookingManager.getBooking(bookingId, tenantId);

      booking.isRejected = true;

      if (hookId) {
        booking.removeHook(hookId);
      }

      const lockerServiceInstance = LockerService.getInstance();

      const result = await lockerServiceInstance.handleCancel(
        booking.tenantId,
        booking.id,
      );

      for (const r of result) {
        if (r.success) {
          booking.lockerInfo = booking.lockerInfo.filter(
            (locker) => locker.processId !== r.processId,
          );
        }
      }

      await BookingManager.storeBooking(booking);

      if (!booking.isCommitted && !hookId) {
        await MailController.sendBookingRejection(
          booking.mail,
          booking.id,
          booking.tenantId,
          reason,
        );
        logger.info(
          `${tenantId} -- booking ${booking.id} rejected and sent booking rejection to ${booking.mail}`,
        );
      } else {
        await MailController.sendBookingCancel(
          booking.mail,
          booking.id,
          booking.tenantId,
          reason,
        );
        logger.info(
          `${tenantId} -- booking ${booking.id} canceled and sent booking rejection to ${booking.mail}`,
        );
      }

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

    const normalizedBookingName = booking.name.trim().toLowerCase();
    const normalizedInputName = name.trim().toLowerCase();

    if (normalizedBookingName !== normalizedInputName) {
      throw { message: "Mismatch", code: 401 };
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
  return bookableItem._bookableUsed.eventId;
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
