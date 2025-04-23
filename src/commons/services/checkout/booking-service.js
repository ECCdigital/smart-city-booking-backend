const bunyan = require("bunyan");
const BookingManager = require("../../data-managers/booking-manager");
const GroupBookingManager = require("../../data-managers/group-booking-manager");
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
const { GroupBooking } = require("../../entities/groupBooking");
const TenantManager = require("../../data-managers/tenant-manager");
const PaymentUtils = require("../../utilities/payment-utils");

const logger = bunyan.createLogger({
  name: "checkout-controller.js",
  level: process.env.LOG_LEVEL,
});
class BookingService {
  /**
   * Creates a booking and stores it in the database.
   * @param tenantId
   * @param user
   * @param bookingAttempt
   * @param simulate
   * @param manualBooking
   * @returns {Promise<Booking>}
   */
  static async createBooking({
    tenantId,
    user,
    bookingAttempt,
    simulate,
    manualBooking = false,
  }) {
    const checkoutId = uuidV4();

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
      isCommitted,
      isPayed,
      isRejected,
    } = bookingAttempt;

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
        Boolean(isCommitted),
        Boolean(isPayed),
        Boolean(isRejected),
        attachmentStatus,
        paymentProvider,
      );
    } else {
      const filteredAddons = await validateMandatoryAddons(bookableItems);
      const filteredBookableItems = bookableItems.concat(filteredAddons);

      bundleCheckoutService = new BundleCheckoutService(
        user?.id,
        tenantId,
        timeBegin,
        timeEnd,
        null,
        filteredBookableItems,
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

      if (booking.isCommitted && booking.isPayed) {
        try {
          const lockerServiceInstance = LockerService.getInstance();
          await lockerServiceInstance.handleCreate(
            booking.tenantId,
            booking.id,
          );
        } catch (err) {
          logger.error(err);
        }
      }
    } else {
      logger.info(`${tenantId}, cid ${checkoutId} -- Simulated booking`);
    }
    return booking;
  }

  /**
   * Creates a single booking and sends confirmation emails.
   * @param tenantId
   * @param user
   * @param bookingAttempt
   * @param simulate
   * @param manualBooking
   * @returns {Promise<Booking>}
   */
  static async createSingleBooking({
    tenantId,
    user,
    bookingAttempt,
    simulate,
    manualBooking = false,
  }) {
    const booking = await BookingService.createBooking({
      tenantId,
      user,
      bookingAttempt,
      simulate,
      manualBooking,
    });

    if (!simulate) {
      try {
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

          if (booking.priceEur > 0) {
            const { receipt, name, receiptId, revision, timeCreated } =
              await ReceiptService.createSingleReceipt(tenantId, booking.id);

            booking.attachments.push({
              type: "receipt",
              title: name,
              receiptId: receiptId,
              revision: revision,
              timeCreated,
            });

            await BookingManager.storeBooking(booking);

            attachments = [
              {
                filename: name,
                content: receipt.buffer,
                contentType: "application/pdf",
              },
            ];
          }

          await MailController.sendBookingConfirmation(
            booking.mail,
            booking.id,
            booking.tenantId,
            attachments,
          );

          const bookableItems = booking.bookableItems.map(
            (bI) => bI._bookableUsed,
          );

          const isTicketBooking = bookableItems.some(isTicket);

          if (isTicketBooking) {
            const eventIds = bookableItems.map(getEventForTicket);
            await sendEmailToOrganizer(eventIds, tenantId, booking);
          }
        }

        const tenant = await TenantManager.getTenant(booking.tenantId);

        await MailController.sendIncomingBooking(
          tenant.mail,
          booking.id,
          booking.tenantId,
        );
      } catch (err) {
        logger.error(err);
      }
    }

    return booking;
  }

  /**
   * Creates a group booking and sends confirmation emails.
   * @param tenantId
   * @param user
   * @param contactData
   * @param bookingAttempts
   * @param simulate
   * @param manualBooking
   * @returns {Promise<GroupBooking>}
   */
  static async createGroupBooking({
    tenantId,
    user,
    contactData,
    bookingAttempts,
    simulate,
    manualBooking = false,
  }) {
    if (!Array.isArray(bookingAttempts) || bookingAttempts.length === 0) {
      throw new Error("", { cause: { code: 400 } });
    }

    const checkoutId = uuidV4();
    logger.info(
      `${tenantId}, cid ${checkoutId} -- multiple checkout request by user ${user?.id}, simulate=${simulate}`,
    );

    const allBookings = [];

    for (const bookingAttempt of bookingAttempts) {
      bookingAttempt.mail = contactData.mail;
      bookingAttempt.name = contactData.name;
      bookingAttempt.company = contactData.company;
      bookingAttempt.street = contactData.street;
      bookingAttempt.zipCode = contactData.zipCode;
      bookingAttempt.location = contactData.location;
      bookingAttempt.phone = contactData.phone;

      const booking = await BookingService.createBooking({
        tenantId,
        user,
        bookingAttempt,
        simulate,
        manualBooking,
      });

      allBookings.push(booking);
    }

    const uniqueId = await generateBookingReference(tenantId);

    const groupBooking = new GroupBooking({
      id: uniqueId,
      tenantId,
      bookingIds: allBookings.map((booking) => booking.id),
      assignedUserId: user?.id,
      mail: contactData.mail,
    });

    await GroupBookingManager.storeGroupBooking(groupBooking);
    const newGroupBooking = await GroupBookingManager.getGroupBooking(
      tenantId,
      uniqueId,
      true,
    );

    if (!simulate) {
      try {
        const allCommitted = newGroupBooking.bookings.every(
          (booking) => booking.isCommitted,
        );

        if (!allCommitted) {
          await MailController.sendBookingRequestConfirmation(
            newGroupBooking.mail,
            newGroupBooking.id,
            newGroupBooking.tenantId,
            true,
          );
        }
        const allPayed = newGroupBooking.bookings.every(
          (booking) => booking.isPayed,
        );

        if (allCommitted && allPayed) {
          let attachments = [];

          await MailController.sendBookingConfirmation(
            newGroupBooking.mail,
            newGroupBooking.id,
            newGroupBooking.tenantId,
            attachments,
            true,
          );
        }

        const tenant = await TenantManager.getTenant(newGroupBooking.tenantId);
        await MailController.sendIncomingBooking(
          tenant.mail,
          newGroupBooking.id,
          newGroupBooking.tenantId,
          true,
        );
      } catch (err) {
        logger.error(`Error while sending email: ${err}`);
      }
    }

    return newGroupBooking;
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

  static async commitBooking(tenantId, booking) {
    try {
      const originBooking = await BookingManager.getBooking(
        booking.id,
        tenantId,
      );
      originBooking.isCommitted = true;
      originBooking.isRejected = false;
      await BookingManager.storeBooking(originBooking);
      if (isNoPaymentRequired(originBooking)) {
        await MailController.sendFreeBookingConfirmation(
          originBooking.mail,
          originBooking.id,
          originBooking.tenantId,
        );
        logger.info(
          `${tenantId} -- booking ${originBooking.id} committed and sent free booking confirmation to ${originBooking.mail}`,
        );
      } else {
        const paymentService = await PaymentUtils.getPaymentService(
          tenantId,
          booking.id,
          booking.paymentProvider,
          { aggregated: false },
        );

        if (!paymentService) return;

        await paymentService.paymentRequest();

        logger.info(
          `${tenantId} -- booking ${originBooking.id} committed and sent payment request to ${originBooking.mail}`,
        );
      }
      const bookableItems = originBooking.bookableItems;
      const isTicketBooking = bookableItems.some(isTicket);

      if (isTicketBooking) {
        const eventIds = bookableItems.map(getEventForTicket);
        await sendEmailToOrganizer(eventIds, tenantId, originBooking);
      }
    } catch (error) {
      throw new Error(`Error committing booking: ${error.message}`);
    }
  }

  static async commitGroupBooking(tenantId, groupBookingId) {
    const groupBooking = await GroupBookingManager.getGroupBooking(
      tenantId,
      groupBookingId,
      true,
    );
    for (const booking of groupBooking.bookings) {
      booking.isCommitted = true;
      booking.isRejected = false;
      await BookingManager.storeBooking(booking);
    }

    if (
      groupBooking.bookings.every((booking) => isNoPaymentRequired(booking))
    ) {
      await MailController.sendFreeBookingConfirmation(
        groupBooking.mail,
        groupBooking.id,
        groupBooking.tenantId,
        true,
      );
      logger.info(
        `${groupBooking.tenantId} -- group-booking ${groupBooking.id} committed and sent free booking confirmation to ${groupBooking.mail}`,
      );
    } else {
      const paymentService = await PaymentUtils.getPaymentService(
        tenantId,
        groupBooking.bookingIds,
        groupBooking.bookings[0].paymentProvider,
        { aggregated: true },
      );

      if (!paymentService) return;

      await paymentService.paymentRequest();
    }

    const hasTicketBooking = groupBooking.bookings.some((booking) =>
      booking.bookableItems.some(isTicket),
    );

    if (hasTicketBooking) {
      //TODO: send email to organizer
      console.log("send email to organizer");
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

      await BookingManager.storeBooking(booking);

      if (!isRejection(booking, hookId)) {
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

  static async rejectGroupBooking(
    tenantId,
    groupBookingId,
    reason = "",
    hookId = null,
  ) {
    const groupBooking = await GroupBookingManager.getGroupBooking(
      tenantId,
      groupBookingId,
      true,
    );

    for (const booking of groupBooking.bookings) {
      booking.isRejected = true;
      await BookingManager.storeBooking(booking);
    }

    if (
      groupBooking.bookings.some((booking) => !isRejection(booking, hookId))
    ) {
      //TODO: send booking rejection
      console.log("send booking rejection");
    } else {
      //TODO: send booking cancel
      console.log("send booking cancel");
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

  static async createReceipt(tenantId, bookingId) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);

    const { name, receiptId, revision, timeCreated } =
      await ReceiptService.createSingleReceipt(tenantId, booking.id);

    booking.attachments.push({
      type: "receipt",
      title: name,
      receiptId: receiptId,
      revision: revision,
      timeCreated,
    });

    await BookingManager.storeBooking(booking);
  }

  static async createAggregatedReceipt(tenantId, bookingIds) {
    const bookings = await BookingManager.getBookings(tenantId, bookingIds);

    const { name, receiptId, revision, timeCreated } =
      await ReceiptService.createAggregatedReceipt(
        tenantId,
        bookings.map((b) => b.id),
      );

    for (const booking of bookings) {
      booking.attachments.push({
        type: "receipt",
        title: name,
        receiptId: receiptId,
        revision: revision,
        timeCreated,
      });
      await BookingManager.storeBooking(booking);
    }
  }
}

module.exports = BookingService;

async function generateBookingReference(
  tenantId,
  length = 8,
  chunkLength = 4,
  possible = "ABCDEFGHJKMNPQRSTUXY",
  ensureUnique = true,
  retryCount = 10,
) {
  if (ensureUnique && retryCount <= 0) {
    throw new Error("Unable to generate booking number. Retry count exceeded.");
  }

  let text = "";
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  for (let i = chunkLength; i < text.length; i += chunkLength + 1) {
    text = text.slice(0, i) + "-" + text.slice(i);
  }

  text = `G-${text}`;

  if (ensureUnique) {
    if (!!(await GroupBookingManager.getGroupBooking(text, tenantId).id)) {
      return await generateBookingReference(
        length,
        chunkLength,
        possible,
        ensureUnique,
        retryCount - 1,
      );
    }
  }

  return text;
}

function isNoPaymentRequired(booking) {
  return (
    booking.isPayed === true || !booking.priceEur || booking.priceEur === 0
  );
}

function isRejection(booking, hookId) {
  return booking.isCommitted && !hookId;
}

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
