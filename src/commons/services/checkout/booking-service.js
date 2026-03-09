const axios = require("axios");
const mime = require("mime-types");
const bunyan = require("bunyan");
const BookingManager = require("../../data-managers/booking-manager");
const CouponService = require("../coupon-service");
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
const {
  Booking,
  BOOKING_HOOK_TYPES,
} = require("../../entities/booking/booking");
const WorkflowService = require("../workflow/workflow-service");
const { BookableManager } = require("../../data-managers/bookable-manager");
const { GroupBooking } = require("../../entities/groupBooking/groupBooking");
const TenantManager = require("../../data-managers/tenant-manager");
const PaymentUtils = require("../../utilities/payment-utils");
const {
  BookingConsistencyService,
  checkSameContactDetails,
  checkSameStatus,
  checkSamePaymentProvider,
  checkPayedStatus,
  validatePaymentProviderRequirement,
} = require("../booking-consitency-service");
const {
  BadRequestError,
  NotFoundError,
  BaseError,
  MethodNotAllowedError,
} = require("../../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "booking-service.js",
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
   * @param skipWorkflow
   * @returns {Promise<Booking>}
   */
  static async createBooking({
    tenantId,
    user,
    bookingAttempt,
    simulate,
    manualBooking = false,
    skipWorkflow = false,
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
      bookWithPrice,
    } = bookingAttempt;

    logger.info(
      `${tenantId}, cid ${checkoutId} -- checkout request by user ${user?.id} with simulate=${simulate}`,
    );
    logger.debug(
      `${tenantId}, cid ${checkoutId} -- Checkout Details: timeBegin=${timeBegin}, timeEnd=${timeEnd}, bookableItems=${bookableItems}, couponCode=${couponCode}, name=${name}, company=${company}, street=${street}, zipCode=${zipCode}, location=${location}, email=${mail}, phone=${phone}, comment=${comment}`,
    );

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
        internalComments: bookingAttempt.internalComments || "",
        rejectionReason: bookingAttempt.rejectionReason || "",
        isCommit: Boolean(isCommitted),
        isPayed: Boolean(isPayed),
        isRejected: Boolean(isRejected),
        attachmentStatus,
        paymentProvider,
        bookWithPrice,
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
        bookWithPrice,
      });
    }

    let booking = await bundleCheckoutService.prepareBooking();

    if (!(booking instanceof Booking)) {
      booking = new Booking(booking);
    }

    booking.validate();

    logger.debug(
      `${tenantId}, cid ${checkoutId} -- Booking prepared: ${JSON.stringify(
        booking,
      )}`,
    );

    if (simulate === false) {
      await BookingManager.storeBooking(booking);

      await CouponService.incrementCouponUsage(couponCode, tenantId);

      if (!skipWorkflow) {
        await WorkflowService.handleWorkflowEvent(
          tenantId,
          booking.id,
          "onCreate",
        );
      }

      logger.info(
        `${tenantId}, cid ${checkoutId} -- Booking ${booking.id} stored by user ${user?.id}`,
      );
      console.log("Booking commit condition:", booking)

      if (booking.isCommitted ) {
        try {
          const lockerServiceInstance = LockerService.getInstance();
          console.log("Attempting to create locker reservation for booking:", lockerServiceInstance);
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
        const mailAttachments = await prepareMailAttachments(
          booking.attachments,
        );
        logger.info(
          `${tenantId} -- Prepared ${mailAttachments.length} mail attachments for booking ${booking.id}`,
        );

        await BookingService.handleSingleBookingRequestConfirmation(
          tenantId,
          booking.id,
          mailAttachments,
        );

        await BookingService.handleSingleBookingConfirmation(
          tenantId,
          booking.id,
          mailAttachments,
        );

        const tenant = await TenantManager.getTenant(booking.tenantId);

        if (tenant.notifyOnNewBooking) {
          await MailController.sendIncomingBooking(
            tenant.mail,
            booking.id,
            booking.tenantId,
          );
        }
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
   * @param paymentProvider
   * @param simulate
   * @param manualBooking
   * @returns {Promise<GroupBooking>}
   */
  static async createGroupBooking({
    tenantId,
    user,
    contactData,
    bookingAttempts,
    paymentProvider,
    simulate,
    manualBooking = false,
  }) {
    if (!Array.isArray(bookingAttempts) || bookingAttempts.length === 0) {
      throw new BadRequestError("missing_booking_attempts");
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
      bookingAttempt.paymentProvider = paymentProvider;
      bookingAttempt.comment = contactData.comment || "";

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
        const allBookingAttachments = newGroupBooking.bookings.flatMap(
          (booking) => booking.attachments,
        );

        const mailAttachments = await prepareMailAttachments(
          allBookingAttachments,
        );

        logger.info(
          `${tenantId} -- Prepared ${mailAttachments.length} mail attachments for group booking ${newGroupBooking.id}`,
        );

        const allCommitted = newGroupBooking.bookings.every(
          (booking) => booking.isCommitted,
        );

        if (!allCommitted) {
          await MailController.sendBookingRequestConfirmation(
            newGroupBooking.mail,
            newGroupBooking.bookingIds,
            newGroupBooking.tenantId,
            true,
            mailAttachments,
          );
        }

        await BookingService.handleAggregatedBookingConfirmation(
          tenantId,
          newGroupBooking.bookingIds,
          mailAttachments,
        );

        const tenant = await TenantManager.getTenant(newGroupBooking.tenantId);

        if (tenant.notifyOnNewBooking) {
          await MailController.sendIncomingBooking(
            tenant.mail,
            newGroupBooking.bookingIds,
            newGroupBooking.tenantId,
            true,
          );
        }
      } catch (err) {
        logger.error(`Error while sending email: ${err}`);
      }
    }

    return newGroupBooking;
  }

  static async cancelBooking(tenantId, bookingId) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);
    if (!booking) {
      throw new NotFoundError("booking_not_found", { bookingId });
    }

    const lockerServiceInstance = LockerService.getInstance();
    await lockerServiceInstance.handleCancel(booking.tenantId, booking.id);
    await BookingManager.removeBooking(booking.id, booking.tenantId);
  }

  static async updateBooking(tenantId, updatedBooking) {
    const oldBooking = await BookingManager.getBooking(
      updatedBooking.id,
      tenantId,
    );

    const isCommit = Boolean(updatedBooking.isCommitted);
    const isPayed = Boolean(updatedBooking.isPayed);
    const isRejected = Boolean(updatedBooking.isRejected);

    if (!oldBooking) {
      throw new NotFoundError("booking_not_found", {
        bookingId: updatedBooking.id,
      });
    }

    try {
      const bundleCheckoutService = new ManualBundleCheckoutService({
        user: updatedBooking.assignedUserId,
        tenant: tenantId,
        timeBegin: updatedBooking.timeBegin,
        timeEnd: updatedBooking.timeEnd,
        timeCreated: oldBooking.timeCreated,
        timePaid: updatedBooking.timePaid
          ? updatedBooking.timePaid
          : oldBooking.timePaid,
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
        internalComments:
          updatedBooking.internalComments || oldBooking.internalComments || "",
        rejectionReason:
          updatedBooking.rejectionReason || oldBooking.rejectionReason || "",
        isCommit: isCommit,
        isPayed: isPayed,
        isRejected: isRejected,
        attachmentStatus: updatedBooking.attachmentStatus,
        paymentProvider: updatedBooking.paymentProvider,
        paymentMethod: updatedBooking.paymentMethod,
        attachments: oldBooking.attachments,
        lockerInfo: oldBooking.lockerInfo,
      });

      let booking = await bundleCheckoutService.prepareBooking({
        keepExistingId: true,
        existingId: oldBooking.id,
      });

      if (!(booking instanceof Booking)) {
        booking = new Booking(booking);
      }
      booking.validate();

      await BookingManager.storeBooking(booking);

      const onCommit = !oldBooking.isCommitted && isCommit;
      const onPay = !oldBooking.isPayed && isPayed;
      const onReject = !oldBooking.isRejected && isRejected;

      if (onCommit) {
        await BookingService.commitBooking(tenantId, booking);
      }

      if (onPay) {
        await BookingService.setBookingPayed({
          tenantId,
          bookingId: booking.id,
        });
      }

      if (onReject) {
        await BookingService.rejectBooking(
          tenantId,
          booking.id,
          booking.rejectionReason,
          null,
        );
      }

      const lockerServiceInstance = LockerService.getInstance();
      await lockerServiceInstance.handleUpdate(
        updatedBooking.tenantId,
        oldBooking,
        booking,
      );

      return booking;
    } catch (error) {
      await BookingManager.storeBooking(oldBooking);
      throw error;
    }
  }

  static async commitBooking(tenantId, booking, skipWorkflow = false) {
    try {
      const originBooking = await BookingManager.getBooking(
        booking.id,
        tenantId,
      );

      const snapshotBooking = { ...originBooking };

      const validator = new BookingConsistencyService([
        validatePaymentProviderRequirement,
      ]);
      const errors = validator.validate([booking]);
      if (errors.length > 0) {
        logger.error(
          `${tenantId} -- booking ${booking.id} cannot be committed: ${JSON.stringify(
            errors,
          )}`,
        );
        return { success: false, errors };
      }

      originBooking.isCommitted = true;
      originBooking.isRejected = false;

      if (!skipWorkflow) {
        await WorkflowService.handleWorkflowEvent(
          tenantId,
          booking.id,
          "onCommit",
          true,
        );
      }

      await BookingManager.storeBooking(originBooking);

      if (isNoPaymentRequired(originBooking)) {
        try {
          const lockerServiceInstance = LockerService.getInstance();
          await lockerServiceInstance.handleCreate(
            originBooking.tenantId,
            originBooking.id,
          );
        } catch (err) {
          await BookingManager.storeBooking(snapshotBooking);
          throw new BaseError("booking_commit_failed", {
            message: `Error during locker creation: ${err.message}`,
          });
        }

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
        const eventIds = bookableItems
          .map(getEventForTicket)
          .filter((id) => id !== null && id !== undefined);
        if (eventIds.length > 0) {
          await sendEmailToOrganizer(eventIds, tenantId, originBooking);
        }
      }

      return { success: true };
    } catch (error) {
      throw new BaseError("booking_commit_failed", {
        message: `Error committing booking: ${error.message}`,
      });
    }
  }

  static async commitGroupBooking(
    tenantId,
    groupBookingId,
    skipWorkflow = false,
  ) {
    const groupBooking = await GroupBookingManager.getGroupBooking(
      tenantId,
      groupBookingId,
      true,
    );
    const bookings = groupBooking.bookings;

    const validator = new BookingConsistencyService([
      checkSameContactDetails,
      checkSameStatus,
      checkSamePaymentProvider,
      validatePaymentProviderRequirement,
    ]);
    const errors = validator.validate(bookings);
    if (errors.length > 0) {
      logger.error(
        `${tenantId} -- group-booking ${groupBooking.id} cannot be committed: ${JSON.stringify(
          errors,
        )}`,
      );
      return { success: false, errors };
    }

    for (const booking of bookings) {
      booking.isCommitted = true;
      booking.isRejected = false;
      await BookingManager.storeBooking(booking);

      if (!skipWorkflow) {
        await WorkflowService.handleWorkflowEvent(
          tenantId,
          booking.id,
          "onCommit",
          true,
        );
      }
    }

    if (bookings.every((booking) => isNoPaymentRequired(booking))) {
      for (const booking of bookings) {
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

      await MailController.sendFreeBookingConfirmation(
        groupBooking.mail,
        groupBooking.bookingIds,
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

      if (!paymentService) return { success: true };

      await paymentService.paymentRequest();

      return { success: true };
    }

    const hasTicketBooking = groupBooking.bookings.some((booking) =>
      booking.bookableItems.some(isTicket),
    );

    if (hasTicketBooking) {
      const bookingsWithTickets = groupBooking.bookings.filter((booking) =>
        booking.bookableItems.some(isTicket),
      );

      for (const booking of bookingsWithTickets) {
        const eventIds = booking.bookableItems.map(getEventForTicket);

        await sendEmailToOrganizer(eventIds, tenantId, booking);
      }
    }
    logger.info(
      `${tenantId} -- group-booking ${groupBooking.id} committed and sent payment request to ${groupBooking.mail}`,
    );
    return { success: true };
  }

  static async setBookingPayed({
    tenantId,
    bookingId,
    skipWorkflow = false,
    paymentMethod,
    timePaid,
  }) {
    try {
      const booking = await BookingManager.getBooking(bookingId, tenantId);
      booking.isPayed = true;

      if (timePaid && typeof timePaid === "number") {
        booking.timePaid = timePaid;
      } else {
        booking.timePaid = Date.now();
      }
      if (paymentMethod) {
        booking.paymentMethod = paymentMethod;
      }
      await BookingManager.storeBooking(booking);
      logger.info(`${tenantId} -- booking ${booking.id} set to payed`);
      if (!skipWorkflow) {
        await WorkflowService.handleWorkflowEvent(
          tenantId,
          booking.id,
          "onPay",
          true,
        );
      }

      try {
        const lockerServiceInstance = LockerService.getInstance();
        await lockerServiceInstance.handleCreate(booking.tenantId, booking.id);
      } catch (err) {
        logger.error(err);
      }

      await BookingService.handleSingleBookingConfirmation(tenantId, bookingId);

      return { success: true };
    } catch (error) {
      throw new BaseError("set_booking_payed_failed", {
        message: `Error setting booking to payed: ${error.message}`,
      });
    }
  }

  static async setAggregatedBookingPayed({
    tenantId,
    bookingIds,
    paymentMethod,
    timePaid,
  }) {
    try {
      const bookings = await BookingManager.getBookings(tenantId, bookingIds);
      for (const booking of bookings) {
        booking.isPayed = true;
        if (timePaid && typeof timePaid === "number") {
          booking.timePaid = timePaid;
        } else {
          booking.timePaid = Date.now();
        }
        if (paymentMethod) {
          booking.paymentMethod = paymentMethod;
        }
        await BookingManager.storeBooking(booking);
        logger.info(`${tenantId} -- booking ${booking.id} set to payed`);

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
      await BookingService.handleAggregatedBookingConfirmation(
        tenantId,
        bookingIds,
      );
      return { success: true };
    } catch (error) {
      throw new BaseError("set_aggregated_booking_payed_failed", {
        message: `Error setting aggregated booking to payed: ${error.message}`,
      });
    }
  }

  static async rejectBooking(
    tenantId,
    bookingId,
    reason = "",
    hookId = null,
    skipWorkflow = false,
  ) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);

    if (!booking) {
      throw new NotFoundError("booking_not_found", { bookingId });
    }

    try {
      booking.isRejected = true;
      booking.rejectionReason = reason;

      if (hookId) {
        booking.removeHook(hookId);
      }

      await BookingManager.storeBooking(booking);

      if (!skipWorkflow) {
        await WorkflowService.handleWorkflowEvent(
          tenantId,
          booking.id,
          "onReject",
          true,
        );
      }

      try {
        const lockerServiceInstance = LockerService.getInstance();
        await lockerServiceInstance.handleCancel(booking.tenantId, booking.id);
      } catch (err) {
        logger.error(err);
      }

      if (isRejection(booking, hookId)) {
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
    } catch (error) {
      throw new BaseError("booking_rejection_failed", {
        message: `Error rejecting booking: ${error.message}`,
      });
    }
  }

  static async rejectGroupBooking(
    tenantId,
    groupBookingId,
    reason = "",
    hookId = null,
    skipWorkflow = false,
  ) {
    const groupBooking = await GroupBookingManager.getGroupBooking(
      tenantId,
      groupBookingId,
      true,
    );

    const bookings = groupBooking.bookings;

    const validator = new BookingConsistencyService([
      checkSameContactDetails,
      checkSameStatus,
    ]);
    const errors = validator.validate(bookings);
    if (errors.length > 0) {
      logger.error(
        `${tenantId} -- group-booking ${groupBooking.id} cannot be rejected: ${JSON.stringify(
          errors,
        )}`,
      );
      return { success: false, errors };
    }

    for (const booking of bookings) {
      booking.isRejected = true;
      booking.rejectionReason = reason;
      await BookingManager.storeBooking(booking);

      try {
        const lockerServiceInstance = LockerService.getInstance();
        await lockerServiceInstance.handleCancel(booking.tenantId, booking.id);
      } catch (err) {
        logger.error(err);
      }

      if (!skipWorkflow) {
        await WorkflowService.handleWorkflowEvent(
          tenantId,
          booking.id,
          "onReject",
          true,
        );
      }
    }

    if (groupBooking.bookings.some((booking) => isRejection(booking, hookId))) {
      await MailController.sendBookingRejection(
        groupBooking.bookings[0].mail,
        groupBooking.bookingIds,
        tenantId,
        reason,
        undefined,
        true,
      );
      logger.info(
        `${tenantId} -- bookings ${groupBooking.bookingIds} rejected and sent booking rejection to ${groupBooking.bookings[0].mail}`,
      );
    } else {
      await MailController.sendBookingCancel(
        groupBooking.bookings[0].mail,
        groupBooking.bookingIds,
        tenantId,
        reason,
        undefined,
        true,
      );
      logger.info(
        `${tenantId} -- bookings ${groupBooking.bookingIds} canceled and sent booking rejection to ${groupBooking.bookings[0].mail}`,
      );
    }

    return { success: true };
  }

  static async requestRejectBooking(tenant, bookingId, reason = "") {
    const booking = await BookingManager.getBooking(bookingId, tenant);

    if (!booking) {
      throw new NotFoundError("booking_not_found", { bookingId });
    }

    try {
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
      throw new BaseError("booking_reject_request_failed", {
        message: `Error requesting booking rejection: ${error.message}`,
      });
    }
  }

  static async checkBookingStatus(bookingId, name, tenantId) {
    const tenant = await getTenant(tenantId);

    if (!tenant.enablePublicStatusView) {
      throw new BaseError("public_status_view_disabled", {
        message: "Public status view disabled",
      });
    }

    const booking = await BookingManager.getBooking(bookingId, tenantId);

    if (!booking.id) {
      throw new NotFoundError("booking_not_found", { bookingId });
    }

    const normalizedBookingName = booking.name.trim().toLowerCase();
    const normalizedInputName = name.trim().toLowerCase();

    if (normalizedBookingName !== normalizedInputName) {
      throw new MethodNotAllowedError("booking_name_mismatch", {
        message: "Provided name does not match booking name",
      });
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
      throw new NotFoundError("booking_not_found", { bookingId });
    }

    return booking.name.toLowerCase() === name.toLowerCase();
  }

  static async createReceipt(tenantId, bookingId) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);

    const validator = new BookingConsistencyService([checkPayedStatus]);
    const errors = validator.validate([booking]);

    if (errors.length > 0) {
      logger.error(
        `${tenantId} -- booking ${booking.id} cannot be rejected: ${JSON.stringify(
          errors,
        )}`,
      );
      return { success: false, errors };
    }

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

    return { success: true };
  }

  static async createAggregatedReceipt(tenantId, bookingIds) {
    const bookings = await BookingManager.getBookings(tenantId, bookingIds);

    const validator = new BookingConsistencyService([
      checkSameContactDetails,
      checkSameStatus,
      checkPayedStatus,
    ]);

    const errors = validator.validate(bookings);
    if (errors.length > 0) {
      logger.error(
        `${tenantId} -- bookings ${bookingIds} cannot create receipt: ${JSON.stringify(
          errors,
        )}`,
      );
      return { success: false, errors };
    }

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

    return { success: true };
  }

  static async handleSingleBookingRequestConfirmation(
    tenantId,
    bookingId,
    additionalAttachments = [],
  ) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);
    if (!booking.isCommitted) {
      try {
        await MailController.sendBookingRequestConfirmation(
          booking.mail,
          booking.id,
          booking.tenantId,
          false,
          additionalAttachments,
        );
      } catch (err) {
        logger.error(err);
      }
    }
  }

  static async handleSingleBookingConfirmation(
    tenantId,
    bookingId,
    additionalAttachments = [],
  ) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);

    if (booking && booking.isCommitted) {
      let attachments = [...additionalAttachments];
      if (booking.priceEur > 0 && booking.isPayed) {
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

      try {
        await MailController.sendBookingConfirmation(
          booking.mail,
          booking.id,
          tenantId,
          attachments,
        );
        logger.info(
          `${tenantId} -- booking ${booking.id} confirmation sent to ${booking.mail}`,
        );
      } catch (err) {
        logger.error(err);
      }

      const bookableItems = booking.bookableItems.map((bI) => bI._bookableUsed);

      const isTicketBooking = bookableItems.some(isTicket);

      if (isTicketBooking) {
        const eventIds = bookableItems
          .map(getEventForTicket)
          .filter((id) => id !== null && id !== undefined);
        await sendEmailToOrganizer(eventIds, tenantId, booking);
      }
    }

    return booking;
  }

  static async handleAggregatedBookingConfirmation(
    tenantId,
    bookingIds,
    additionalAttachments = [],
  ) {
    const bookings = await BookingManager.getBookings(tenantId, bookingIds);

    if (bookings.every((b) => b.isCommitted && b.isPayed)) {
      let attachments = [...additionalAttachments];
      if (bookings.reduce((acc, b) => acc + b.priceEur, 0) > 0) {
        const { receipt, name, receiptId, revision, timeCreated } =
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

        attachments = [
          {
            filename: name,
            content: receipt.buffer,
            contentType: "application/pdf",
          },
        ];
      }

      try {
        await MailController.sendBookingConfirmation(
          bookings[0].mail,
          bookings.map((b) => b.id),
          tenantId,
          attachments,
          true,
        );
        logger.info(
          `${tenantId} -- bookings ${bookingIds} confirmation sent to ${bookings[0].mail}`,
        );
      } catch (err) {
        logger.error(err);
      }
    }

    return bookings;
  }

  static async getBookedSeatsCount(tenantId, eventId, params) {
    return await BookingManager.getBookedSeatsCount(tenantId, eventId, params);
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
    throw new BaseError("booking_reference_generation_failed", {
      message:
        "Failed to generate unique booking reference after multiple attempts",
    });
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
    const existingGroupBooking = await GroupBookingManager.getGroupBooking(
      tenantId,
      text,
    );
    if (existingGroupBooking?.id) {
      return await generateBookingReference(
        tenantId,
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
  return !booking.priceEur || booking.priceEur === 0 || booking.isPayed;
}

function isRejection(booking, hookId) {
  return !booking.isCommitted && !hookId;
}

function isTicket(bookableItem) {
  return bookableItem?.type === "ticket";
}

function getEventForTicket(bookableItem) {
  return bookableItem?.eventId || null;
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

/**
 * Downloads and prepares attachments for email sending
 * @param {Array} attachments - Array of attachment objects from booking
 * @returns {Promise<Array>} - Array of attachments in nodemailer format
 */
async function prepareMailAttachments(attachments) {
  if (!attachments || !Array.isArray(attachments)) {
    return [];
  }

  const attachmentsToMail = attachments.filter(
    (att) => att.mailAttach === true && att.url,
  );

  const uniqueAttachments = [];
  const seenUrls = new Set();

  for (const att of attachmentsToMail) {
    if (!seenUrls.has(att.url)) {
      uniqueAttachments.push(att);
      seenUrls.add(att.url);
    }
  }

  if (uniqueAttachments.length === 0) {
    return [];
  }

  const downloadedAttachments = await Promise.all(
    uniqueAttachments.map(async (att) => {
      try {
        const response = await axios.get(att.url, {
          responseType: "arraybuffer",
          timeout: 30000,
          maxContentLength: 25 * 1024 * 1024,
        });

        const filename = extractFilename(att.url, att.title);

        const contentType = determineContentType(
          response.headers["content-type"],
          filename,
        );

        logger.debug(
          `Downloaded attachment: ${filename} (${contentType}, ${response.data.byteLength} bytes)`,
        );

        const attachment = {
          filename: filename,
          content: Buffer.from(response.data),
          contentType: contentType,
        };

        if (!isAttachmentSafe(attachment)) {
          logger.warn(
            `Attachment ${filename} failed safety validation, skipping`,
          );
          return null;
        }

        return attachment;
      } catch (err) {
        logger.error(
          `Failed to download attachment from ${att.url}: ${err.message}`,
        );
        return null;
      }
    }),
  );

  return downloadedAttachments.filter((att) => att !== null);
}

/**
 * Extracts a clean filename from URL or generates one from title
 * @param {string} url - The attachment URL
 * @param {string} title - The attachment title
 * @returns {string} - Clean filename
 */
function extractFilename(url, title) {
  try {
    let urlFilename = "";
    let extension = ".pdf";

    try {
      const urlObj = new URL(url);

      const nameParam = urlObj.searchParams.get("name");
      if (nameParam) {
        const pathParts = nameParam.split("/");
        urlFilename = pathParts[pathParts.length - 1];
      } else {
        const pathParts = urlObj.pathname.split("/");
        urlFilename = decodeURIComponent(pathParts[pathParts.length - 1]);
      }

      if (urlFilename && urlFilename.includes(".")) {
        extension = "." + urlFilename.split(".").pop().toLowerCase();
      }
    } catch (urlError) {
      const urlParts = url.split("?")[0].split("/");
      urlFilename = decodeURIComponent(urlParts[urlParts.length - 1]);
      if (urlFilename.includes(".")) {
        extension = "." + urlFilename.split(".").pop().toLowerCase();
      }
    }

    if (title && title.trim().length > 0) {
      let filename = sanitizeFilename(title);

      if (filename.includes(".")) {
        filename = filename.substring(0, filename.lastIndexOf("."));
      }

      return filename + extension;
    }

    if (urlFilename && urlFilename.length >= 3 && urlFilename !== "get") {
      return urlFilename;
    }

    return "Anhang" + extension;
  } catch (err) {
    return "Anhang.pdf";
  }
}

/**
 * Sanitizes a string to be used as filename
 * @param {string} str - Input string
 * @returns {string} - Sanitized filename
 */
function sanitizeFilename(str) {
  if (!str) return "attachment";

  return str
    .replace(/[^a-zA-Z0-9äöüÄÖÜß._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 200);
}

/**
 * Determines content type from header or filename extension
 * @param {string} headerContentType - Content-Type from HTTP response
 * @param {string} filename - The filename
 * @returns {string} - MIME type
 */
function determineContentType(headerContentType, filename) {
  if (headerContentType && headerContentType !== "application/octet-stream") {
    return headerContentType.split(";")[0].trim();
  }

  const mimeType = mime.lookup(filename);
  if (mimeType) {
    return mimeType;
  }

  const extension = filename.split(".").pop().toLowerCase();
  return getMimeTypeFromExtension(extension);
}

/**
 * Manual MIME type mapping for common file extensions
 * @param {string} extension - File extension without dot
 * @returns {string} - MIME type
 */
function getMimeTypeFromExtension(extension) {
  const mimeTypes = {
    // Documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odp: "application/vnd.oasis.opendocument.presentation",
    rtf: "application/rtf",
    txt: "text/plain",
    csv: "text/csv",

    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    webp: "image/webp",
    tiff: "image/tiff",
    tif: "image/tiff",
    ico: "image/x-icon",

    // Archives
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
    tar: "application/x-tar",
    gz: "application/gzip",

    // Media
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
    wmv: "video/x-ms-wmv",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",

    // Web
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "application/javascript",
    json: "application/json",
    xml: "application/xml",

    // Other
    ics: "text/calendar",
    vcf: "text/vcard",
    eml: "message/rfc822",
  };

  return mimeTypes[extension] || "application/octet-stream";
}

/**
 * Validates if attachment is safe to send
 * @param {Object} attachment - Attachment object
 * @returns {boolean} - Whether attachment is safe
 */
function isAttachmentSafe(attachment) {
  const dangerousExtensions = [
    "exe",
    "bat",
    "cmd",
    "com",
    "pif",
    "scr",
    "vbs",
    "js",
    "jar",
  ];

  const maxSize = 25 * 1024 * 1024;

  if (attachment.content.byteLength > maxSize) {
    logger.warn(
      `Attachment ${attachment.filename} exceeds size limit (${attachment.content.byteLength} bytes)`,
    );
    return false;
  }

  const extension = attachment.filename.split(".").pop().toLowerCase();
  if (dangerousExtensions.includes(extension)) {
    logger.warn(
      `Attachment ${attachment.filename} has dangerous extension: ${extension}`,
    );
    return false;
  }

  return true;
}
