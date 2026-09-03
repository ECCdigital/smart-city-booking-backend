const bunyan = require("bunyan");
const BookingManager = require("../../data-managers/booking-manager");
const CouponService = require("../coupon-service");
const GroupBookingManager = require("../../data-managers/group-booking-manager");
const MailController = require("../../mail-service/mail-controller");
const { v4: uuidV4 } = require("uuid");
const { BundleCheckoutService } = require("./bundle-checkout-service");
const AccessService = require("../access/access-service");
const { notifyOrganizers } = require("../booking-lifecycle/adapters/mail");
const {
  Booking,
  BOOKING_HOOK_TYPES,
} = require("../../entities/booking/booking");
const WorkflowService = require("../workflow/workflow-service");
const { BookableManager } = require("../../data-managers/bookable-manager");
const { GroupBooking } = require("../../entities/groupBooking/groupBooking");
const TenantManager = require("../../data-managers/tenant-manager");
const SupervisorNotificationService = require("../supervisor-notification-service");
const PaymentUtils = require("../../utilities/payment-utils");
const {
  BookingConsistencyService,
  checkSameContactDetails,
  checkSameStatus,
  checkSamePaymentProvider,
  checkInvoicePaymentProvider,
  checkPayedStatus,
  validatePaymentProviderRequirement,
} = require("../booking-consitency-service");
const {
  STATUS,
  TRIGGER,
  CANCELLED_FROM_STATUSES,
  statusFromFlags,
} = require("../booking-lifecycle/booking-state");
const {
  CancellationRefundService,
  CANCELLATION_ORIGINS,
} = require("../payment/cancellation-refund-service");
const {
  BadRequestError,
  NotFoundError,
  BaseError,
  MethodNotAllowedError,
  ForbiddenError,
  UnauthorizedError,
} = require("../../../errors/BaseError");
const {
  issue: issueDocument,
  remove: removeDocuments,
  groupBookingIdOf,
  mailAttachments,
} = require("../documents/document-issuance");
const {
  prepareMailAttachments,
} = require("../booking-lifecycle/mail-attachments");
const { bookingLifecycle, LifecycleError } = require("../booking-lifecycle");
const {
  resolveCheckoutId,
  resolveCheckoutItems,
} = require("../../utilities/checkout-utils");
const checkoutPolicy = require("./checkout-policy");
const { CheckoutPolicy } = checkoutPolicy;
const { CustomFieldService } = require("../custom-field/custom-field-service");
const { CheckoutError } = require("../../../errors/CheckoutError");
const { CHECKOUT_REASONS } = require("./checkout-reasons");

const logger = bunyan.createLogger({
  name: "booking-service.js",
  level: process.env.LOG_LEVEL,
});
class BookingService {
  static async _resolveCheckoutCustomFieldValues({
    tenantId,
    bookableItems,
    customFieldValues,
  }) {
    const values = Array.isArray(customFieldValues) ? customFieldValues : [];

    const { instanceFields, tenantFields } =
      await BookableManager.getCustomFieldDefinitions(tenantId);

    const bookableIds = [
      ...new Set(bookableItems.map((item) => item.bookableId)),
    ];
    const bookables = await Promise.all(
      bookableIds.map((id) => BookableManager.getBookable(id, tenantId)),
    );

    const bookableFields = bookables.flatMap(
      (bookable) => bookable?.customFieldDefinitions || [],
    );

    const mergedDefinitions = CustomFieldService.mergeDefinitions({
      instanceFields,
      tenantFields,
      bookableFields,
    });

    const checkoutDefinitions =
      CustomFieldService.filterCheckoutDefinitions(mergedDefinitions);

    if (checkoutDefinitions.length === 0 && values.length === 0) {
      return [];
    }

    const { valid, errors } = CustomFieldService.validateValues(
      checkoutDefinitions,
      values,
    );

    if (!valid) {
      throw new CheckoutError({
        reason: CHECKOUT_REASONS.CUSTOM_FIELDS_INVALID,
        statusCode: 400,
        params: { errors },
      });
    }

    return values;
  }

  static _resolveCustomFieldValuesForUpdate(
    updatedBooking,
    oldBooking,
    requestBody = {},
  ) {
    if (
      Array.isArray(requestBody.customFields) &&
      requestBody.customFields.length > 0
    ) {
      return requestBody.customFields.map((field) => ({
        fieldId: field.id ?? field.fieldId,
        value: field.value ?? null,
      }));
    }

    if ("customFieldValues" in requestBody) {
      return Array.isArray(requestBody.customFieldValues)
        ? requestBody.customFieldValues
        : [];
    }

    if ("customFields" in requestBody) {
      return [];
    }

    return oldBooking.customFieldValues || [];
  }

  /**
   * Creates a booking and stores it in the database.
   * @param tenantId
   * @param user
   * @param bookingAttempt
   * @param simulate
   * @param policy - The checkout policy (see checkout-policy.js).
   * @param skipWorkflow
   * @param providedCheckoutId - Optional checkoutId to use instead of generating a new one
   * @returns {Promise<Booking>}
   */
  static async createBooking({
    tenantId,
    user,
    bookingAttempt,
    simulate,
    policy = CheckoutPolicy.SELF_SERVICE,
    skipWorkflow = false,
    checkoutId: providedCheckoutId,
  }) {
    checkoutPolicy.assertCheckoutPolicy(policy);
    const checkoutId = providedCheckoutId || uuidV4();

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
      bookWithoutDiscount,
      customFieldValues: rawCustomFieldValues,
      cancellationPolicy,
    } = bookingAttempt;

    const customFieldValues =
      await BookingService._resolveCheckoutCustomFieldValues({
        tenantId,
        bookableItems,
        customFieldValues: rawCustomFieldValues,
      });

    logger.info(
      `${tenantId}, cid ${checkoutId} -- checkout request by user ${user?.id} with simulate=${simulate}`,
    );
    logger.debug(
      `${tenantId}, cid ${checkoutId} -- Checkout Details: timeBegin=${timeBegin}, timeEnd=${timeEnd}, bookableItems=${bookableItems}, couponCode=${couponCode}, name=${name}, company=${company}, street=${street}, zipCode=${zipCode}, location=${location}, email=${mail}, phone=${phone}, comment=${comment}`,
    );

    // Check invoice payment permission
    if (
      paymentProvider?.toLowerCase() === "invoice" &&
      checkoutPolicy.requiresInvoicePermission(policy)
    ) {
      const isPermitted = await PaymentUtils.checkInvoicePermission(
        tenantId,
        user?.id,
      );
      if (!isPermitted) {
        throw new ForbiddenError("invoice_payment_not_permitted", {
          message: "Sie sind nicht berechtigt, per Rechnung zu bezahlen.",
        });
      }
    }

    const checkoutItems = checkoutPolicy.resolvesMandatoryAddons(policy)
      ? await resolveCheckoutItems(bookableItems, tenantId)
      : bookableItems;

    const adminOverrides = checkoutPolicy.acceptsAdminOverrides(policy)
      ? {
          internalComments: bookingAttempt.internalComments || "",
          rejectionReason: bookingAttempt.rejectionReason || "",
          isCommitted: Boolean(isCommitted),
          isPayed: Boolean(isPayed),
          isRejected: Boolean(isRejected),
          cancellationPolicy,
        }
      : undefined;

    const bundleCheckoutService = new BundleCheckoutService(
      {
        user: user?.id,
        tenant: tenantId,
        timeBegin,
        timeEnd,
        bookableItems: checkoutItems,
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
        bookWithoutDiscount,
        checkoutId: providedCheckoutId,
        customFieldValues,
      },
      policy,
      adminOverrides,
    );

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

      // The compartments of the booking's locker systems are held first
      // - the hold checks their capacity and fails where none is left -
      // and, for a booking paid at once, granted right after with the
      // doors. Either failing rolls the booking back: it never existed.
      try {
        await AccessService.holdForBooking(booking.tenantId, booking.id);

        if (booking.isCommitted && booking.isPayed) {
          await AccessService.provisionForBooking(booking.tenantId, booking.id);
        }
      } catch (err) {
        logger.error(
          `${tenantId}, cid ${checkoutId} -- Access setup failed ` +
            `for booking ${booking.id}, rolling back: ${err.message}`,
        );

        try {
          await BookingManager.removeBooking(booking.id, tenantId);
          await CouponService.decrementCouponUsage(couponCode, tenantId);
          logger.info(
            `${tenantId}, cid ${checkoutId} -- Booking ${booking.id} ` +
              `rolled back successfully`,
          );
        } catch (rollbackErr) {
          logger.error(
            `${tenantId}, cid ${checkoutId} -- Rollback failed for ` +
              `booking ${booking.id}: ${rollbackErr.message}`,
          );
        }

        throw err;
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
   * @param policy - The checkout policy (see checkout-policy.js).
   * @param checkoutId - Optional checkoutId to use instead of generating a new one
   * @returns {Promise<Booking>}
   */
  static async createSingleBooking({
    tenantId,
    user,
    bookingAttempt,
    simulate,
    policy = CheckoutPolicy.SELF_SERVICE,
    checkoutId,
  }) {
    const booking = await BookingService.createBooking({
      tenantId,
      user,
      bookingAttempt,
      simulate,
      policy,
      checkoutId,
    });

    if (!simulate) {
      try {
        const mailAttachments = await prepareMailAttachments(
          booking.attachments,
          tenantId,
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

        await SupervisorNotificationService.notifySupervisorsOnBookingCreated({
          tenantId: booking.tenantId,
          userId: booking.assignedUserId,
          bookingIds: booking.id,
        });
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
   * @param policy - The checkout policy (see checkout-policy.js).
   * @returns {Promise<GroupBooking>}
   */
  static async createGroupBooking({
    tenantId,
    user,
    contactData,
    bookingAttempts,
    paymentProvider,
    simulate,
    policy = CheckoutPolicy.SELF_SERVICE,
  }) {
    if (!Array.isArray(bookingAttempts) || bookingAttempts.length === 0) {
      throw new BadRequestError("missing_booking_attempts");
    }

    const sortedBookingAttempts = [...bookingAttempts].sort(
      (a, b) => Number(a.timeBegin) - Number(b.timeBegin),
    );

    // Check invoice payment permission
    if (
      paymentProvider?.toLowerCase() === "invoice" &&
      checkoutPolicy.requiresInvoicePermission(policy)
    ) {
      const isPermitted = await PaymentUtils.checkInvoicePermission(
        tenantId,
        user?.id,
      );
      if (!isPermitted) {
        throw new ForbiddenError("invoice_payment_not_permitted", {
          message: "Sie sind nicht berechtigt, per Rechnung zu bezahlen.",
        });
      }
    }

    const checkoutId = uuidV4();
    logger.info(
      `${tenantId}, cid ${checkoutId} -- multiple checkout request by user ${user?.id}, simulate=${simulate}`,
    );

    const allBookings = [];

    for (const bookingAttempt of sortedBookingAttempts) {
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
        policy,
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
          tenantId,
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
          newGroupBooking.id,
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

        await SupervisorNotificationService.notifySupervisorsOnBookingCreated({
          tenantId: newGroupBooking.tenantId,
          userId: newGroupBooking.assignedUserId,
          bookingIds: newGroupBooking.bookingIds,
          aggregated: true,
        });
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

    await AccessService.revokeForBooking(booking.tenantId, booking.id);

    // Documents go first: a booking document that outlived its booking would
    // be unreachable and undeletable — nobody could ever grant access to it.
    await removeDocuments({ tenantId: booking.tenantId, booking });

    await BookingManager.removeBooking(booking.id, booking.tenantId);
  }

  static async updateBooking(tenantId, updatedBooking, { requestBody } = {}) {
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

    const onUnreject = oldBooking.isRejected && !isRejected;

    const { checkoutId } = await resolveCheckoutId(
      undefined,
      oldBooking.assignedUserId,
      tenantId,
    );

    try {
      // Every booking update is a manual booking (see CONTEXT.md,
      // "Manuelle Buchung"): the entered values are authoritative, no checks
      // run and no automatic discounts apply.
      const bundleCheckoutService = new BundleCheckoutService(
        {
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
          attachmentStatus: updatedBooking.attachmentStatus,
          paymentProvider: updatedBooking.paymentProvider,
          attachments: oldBooking.attachments,
          checkoutId,
          customFieldValues: updatedBooking.customFieldValues,
          amendedBookingId: oldBooking.id,
        },
        CheckoutPolicy.ADMIN_MANUAL,
        {
          internalComments:
            updatedBooking.internalComments ||
            oldBooking.internalComments ||
            "",
          rejectionReason:
            updatedBooking.rejectionReason || oldBooking.rejectionReason || "",
          isCommitted: isCommit,
          isPayed: isPayed,
          isRejected: isRejected,
          paymentMethod: updatedBooking.paymentMethod,
          accessInfo: oldBooking.accessInfo,
          cancellationPolicy: updatedBooking.cancellationPolicy,
        },
      );

      let booking = await bundleCheckoutService.prepareBooking({
        keepExistingId: true,
        existingId: oldBooking.id,
      });

      if (!(booking instanceof Booking)) {
        booking = new Booking(booking);
      }

      if (onUnreject) {
        booking.priceEur = oldBooking.priceEur;
        booking.vatIncludedEur = oldBooking.vatIncludedEur;
        booking.bookableItems = oldBooking.bookableItems;
        booking.couponCode = oldBooking.couponCode;
        booking._couponUsed = oldBooking._couponUsed;
        booking.rejectionReason = "";
        delete booking.cancellationRefund;
      } else if (oldBooking.cancellationRefund) {
        // A cancelled or rejected booking that stays so keeps its refund
        // audit: the prepared booking would otherwise write over it with
        // what its flags alone say about the cancellation.
        booking.cancellationRefund = oldBooking.cancellationRefund;
      }

      booking.validate();

      const onCommit = !oldBooking.isCommitted && isCommit;
      const onPay = !oldBooking.isPayed && isPayed;
      const onReject = !oldBooking.isRejected && isRejected;

      // The confirmation and the payment are lifecycle transitions out of
      // `requested` and `payment_due` (spec part 1, 4.1): the content write
      // leaves the booking where the transition starts, `confirm` and `pay`
      // move it on. Ticket 7 turns the whole PUT into the plan of
      // `update-plan.js`.
      const requestedStatus = booking.status;
      if (onCommit) {
        booking.status = STATUS.REQUESTED;
      } else if (onPay) {
        booking.status = STATUS.PAYMENT_DUE;
      }

      await BookingManager.storeBooking(
        booking,
        true,
        onUnreject ? { unset: ["cancellationRefund"] } : undefined,
      );

      if (onCommit) {
        await BookingService.commitBooking(tenantId, booking, {
          trigger: TRIGGER.ADMIN,
        });
        booking.status = requestedStatus;
      }

      if (onPay) {
        await BookingService.setBookingPayed({
          tenantId,
          bookingId: booking.id,
          trigger: TRIGGER.ADMIN,
        });
        booking.status = requestedStatus;
      }

      if (onReject) {
        await BookingService.rejectBooking(
          tenantId,
          booking.id,
          booking.rejectionReason,
          null,
          false,
          false,
          null,
          { origin: CANCELLATION_ORIGINS.SYSTEM },
        );
      }

      if (booking.isCommitted && booking.isPayed && !onUnreject) {
        if (!booking.isRejected) {
          await AccessService.updateForBooking(
            updatedBooking.tenantId,
            oldBooking,
            booking,
          );
        }
      } else if (onUnreject) {
        await AccessService.provisionForBooking(
          updatedBooking.tenantId,
          booking.id,
        );
      } else {
        // Not paid (any more): whatever was granted is taken back, and the
        // compartments are held for what the booking books now - unless it
        // is rejected, which claims nothing.
        await AccessService.revokeForBooking(
          updatedBooking.tenantId,
          booking.id,
        );
        if (!booking.isRejected) {
          await AccessService.holdForBooking(
            updatedBooking.tenantId,
            booking.id,
          );
        }
      }

      return booking;
    } catch (error) {
      await BookingManager.storeBooking(oldBooking);
      throw error;
    }
  }

  /**
   * The confirmation of a booking: the lifecycle transition `confirm`
   * (spec part 2, section 8) over the default instance, `requested →
   * payment_due` with the payment request for a priced booking, `requested
   * → confirmed` with the grant and the free booking confirmation for a
   * free one. `trigger` names who set it off (glossary "Auslöser"). The
   * consistency check of before stays in front of the transition and keeps
   * its answer, `{ success: false, errors }`; a guard error (the booking is
   * not a request) and a missing booking pass through as the 409 and 404
   * they are, an aborted transition as the `LifecycleError` the controller
   * maps.
   *
   * @param {string} tenantId
   * @param {{ id: string }} booking The booking to confirm; what it carries
   *   beyond the id is checked for consistency, the transition reads the
   *   stored booking
   * @param {{ trigger: string }} options
   * @returns {Promise<{ success: boolean, errors?: Object[] }>}
   */
  static async commitBooking(tenantId, booking, { trigger } = {}) {
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

    const outcome = await bookingLifecycle.confirm(tenantId, booking.id, {
      trigger: trigger || TRIGGER.ADMIN,
    });
    logger.info(
      `${tenantId} -- booking ${booking.id} committed, now ${outcome.status}`,
    );
    return { success: true };
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
      setStatusFromFlags(booking, { isCommitted: true, isRejected: false });
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
          await AccessService.provisionForBooking(booking.tenantId, booking.id);
        } catch (err) {
          logger.error(err);
        }
      }

      await MailController.sendFreeBookingConfirmation(
        groupBooking.mail,
        groupBooking.bookingIds,
        groupBooking.tenantId,
        undefined,
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
        { aggregated: true, groupBookingId: groupBooking.id },
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

  /**
   * The payment of a booking: the lifecycle transition `pay` (spec part 2,
   * section 8) over the default instance. `trigger` names who set it off
   * (glossary "Auslöser"); `skipWorkflow` is the old spelling of
   * `trigger: workflow`. A guard error (the booking is not awaiting
   * payment, or two payments raced) and a missing booking pass through as
   * the 409 and 404 they are; an aborted transition is the
   * `set_booking_payed_failed` of before.
   */
  static async setBookingPayed({
    tenantId,
    bookingId,
    skipWorkflow = false,
    trigger,
    paymentMethod,
    timePaid,
  }) {
    try {
      await bookingLifecycle.pay(tenantId, bookingId, {
        trigger: trigger || (skipWorkflow ? TRIGGER.WORKFLOW : TRIGGER.ADMIN),
        paymentMethod,
        timePaid,
      });
      logger.info(`${tenantId} -- booking ${bookingId} set to payed`);
      return { success: true };
    } catch (error) {
      if (error instanceof LifecycleError) {
        throw new BaseError("set_booking_payed_failed", {
          message: `Error setting booking to payed: ${error.message}`,
        });
      }
      throw error;
    }
  }

  static async setAggregatedBookingPayed({
    tenantId,
    bookingIds,
    paymentMethod,
    timePaid,
    groupBookingId = null,
  }) {
    try {
      const bookings = await BookingManager.getBookings(tenantId, bookingIds);
      for (const booking of bookings) {
        setStatusFromFlags(booking, { isPayed: true });
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
          await AccessService.provisionForBooking(booking.tenantId, booking.id);
        } catch (err) {
          logger.error(err);
        }
      }
      await BookingService.handleAggregatedBookingConfirmation(
        tenantId,
        bookingIds,
        [],
        groupBookingId,
      );
      return { success: true };
    } catch (error) {
      throw new BaseError("set_aggregated_booking_payed_failed", {
        message: `Error setting aggregated booking to payed: ${error.message}`,
      });
    }
  }

  static async getCancellationRefundPreview(tenantId, bookingId) {
    const [tenant, booking] = await Promise.all([
      TenantManager.getTenant(tenantId),
      BookingManager.getBooking(bookingId, tenantId),
    ]);

    if (!tenant) {
      throw new NotFoundError("tenant_not_found", { tenantId });
    }
    if (!booking) {
      throw new NotFoundError("booking_not_found", { bookingId });
    }

    return {
      bookingId,
      ...CancellationRefundService.calculate({
        tenant,
        booking,
        origin: CANCELLATION_ORIGINS.ADMIN,
      }),
    };
  }

  static toCustomerCancellationRefundPreview(calculation, bookingId) {
    return {
      bookingId,
      originalAmountEur: calculation.originalAmountEur,
      refundAmountEur: calculation.refundAmountEur,
      cancellationFeeEur: calculation.cancellationFeeEur,
      suggestedRefundPercentage: calculation.suggestedRefundPercentage,
      appliedRefundPercentage: calculation.appliedRefundPercentage,
      daysBeforeStart: calculation.daysBeforeStart,
      appliedTierDays: calculation.appliedTierDays,
    };
  }

  static async getUserCancellationRefundPreview(tenantId, bookingId) {
    const [tenant, booking] = await Promise.all([
      TenantManager.getTenant(tenantId),
      BookingManager.getBooking(bookingId, tenantId),
    ]);

    if (!tenant) {
      throw new NotFoundError("tenant_not_found", { tenantId });
    }
    if (!booking || !booking.id) {
      throw new NotFoundError("booking_not_found", { bookingId });
    }
    if (booking.isRejected === true) {
      throw new ForbiddenError("booking_already_rejected", { bookingId });
    }
    if (booking.cancellationPolicy?.userCancellable !== true) {
      throw new ForbiddenError("booking_user_cancellation_disabled", {
        bookingId,
      });
    }

    const calculation = CancellationRefundService.calculate({
      tenant,
      booking,
      origin: CANCELLATION_ORIGINS.USER,
    });

    return this.toCustomerCancellationRefundPreview(calculation, bookingId);
  }

  static async getPublicCancellationRefundPreview(tenantId, bookingId, name) {
    if (!name || typeof name !== "string" || !name.trim()) {
      throw new BadRequestError("missing_name");
    }

    const ownsBooking = await this.verifyBookingOwnership(
      tenantId,
      bookingId,
      name,
    );
    if (!ownsBooking) {
      throw new UnauthorizedError("booking_name_mismatch", { bookingId });
    }

    return this.getUserCancellationRefundPreview(tenantId, bookingId);
  }

  static async getHookCancellationRefundPreview(tenantId, bookingId, hookId) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);

    if (!booking || !booking.id) {
      throw new NotFoundError("booking_not_found", { bookingId });
    }

    const hook = booking.getHook ? booking.getHook(hookId) : null;
    if (!hook || hook.type !== BOOKING_HOOK_TYPES.REJECT) {
      throw new NotFoundError("booking_hook_not_found", { bookingId, hookId });
    }

    return this.getUserCancellationRefundPreview(tenantId, bookingId);
  }

  static async getGroupCancellationRefundPreview(tenantId, groupBookingId) {
    const [tenant, groupBooking] = await Promise.all([
      TenantManager.getTenant(tenantId),
      GroupBookingManager.getGroupBooking(tenantId, groupBookingId, false),
    ]);

    if (!tenant) {
      throw new NotFoundError("tenant_not_found", { tenantId });
    }
    if (!groupBooking) {
      throw new NotFoundError("group_booking_not_found", { groupBookingId });
    }

    const bookings = await BookingManager.getBookings(
      tenantId,
      groupBooking.bookingIds,
    );
    if (bookings.length !== groupBooking.bookingIds.length) {
      throw new NotFoundError("booking_not_found", {
        groupBookingId,
      });
    }

    bookings.sort((a, b) => Number(a.timeBegin) - Number(b.timeBegin));

    const cancelledAt = Date.now();
    const previewBookings = bookings.map((booking) => ({
      bookingId: booking.id,
      timeBegin: booking.timeBegin,
      timeEnd: booking.timeEnd,
      ...CancellationRefundService.calculate({
        tenant,
        booking,
        cancelledAt,
        origin: CANCELLATION_ORIGINS.ADMIN,
      }),
    }));

    return {
      groupBookingId,
      cancelledAt,
      bookings: previewBookings,
      originalAmountEur:
        previewBookings.reduce(
          (total, booking) =>
            total + Math.round(booking.originalAmountEur * 100),
          0,
        ) / 100,
      refundAmountEur:
        previewBookings.reduce(
          (total, booking) => total + Math.round(booking.refundAmountEur * 100),
          0,
        ) / 100,
      cancellationFeeEur:
        previewBookings.reduce(
          (total, booking) =>
            total + Math.round(booking.cancellationFeeEur * 100),
          0,
        ) / 100,
    };
  }

  static async rejectBooking(
    tenantId,
    bookingId,
    reason = "",
    hookId = null,
    skipWorkflow = false,
    skipCancellation = false,
    bankDetails = null,
    cancellationContext = {},
  ) {
    const [booking, tenant] = await Promise.all([
      BookingManager.getBooking(bookingId, tenantId),
      TenantManager.getTenant(tenantId),
    ]);

    if (!booking) {
      throw new NotFoundError("booking_not_found", { bookingId });
    }
    if (!tenant) {
      throw new NotFoundError("tenant_not_found", { tenantId });
    }

    try {
      const cancelledFrom = cancelledFromOf(booking);
      setStatusFromFlags(booking, { isRejected: true });
      booking.rejectionReason = reason;

      if (hookId) {
        booking.removeHook(hookId);
      }

      const refundCalculation = CancellationRefundService.calculate({
        tenant,
        booking,
        cancelledAt: cancellationContext.cancelledAt ?? Date.now(),
        origin: cancellationContext.origin || CANCELLATION_ORIGINS.SYSTEM,
        refundPercentage: cancellationContext.refundPercentage,
        cancelledByUserId: cancellationContext.cancelledByUserId,
      });
      booking.cancellationRefund = { ...refundCalculation };
      recordCancelledFrom(booking, cancelledFrom);

      let attachments;

      if (booking.priceEur > 0 && !skipCancellation) {
        const sanitizedBankDetails = sanitizeBankDetails(bankDetails);
        const options = {
          alreadyPaid: booking.isPayed,
          bankDetails: sanitizedBankDetails || undefined,
          cancellationReason: reason,
          refundCalculation,
        };
        // The issuance attaches the document to the booking and to this
        // entity, so the state write below carries it too.
        const { file } = await issueDocument({
          tenantId,
          bookingIds: [booking.id],
          type: "cancellation",
          bookings: [booking],
          options,
        });

        attachments = mailAttachments(file);
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
        await AccessService.revokeForBooking(booking.tenantId, booking.id);
      } catch (err) {
        logger.error(err);
      }

      if (isRejection(booking, hookId)) {
        await MailController.sendBookingRejection(
          booking.mail,
          booking.id,
          booking.tenantId,
          reason,
          attachments,
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
          attachments,
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
    skipCancellation = false,
    bankDetails = null,
    cancellationContext = {},
  ) {
    const [groupBooking, tenant] = await Promise.all([
      GroupBookingManager.getGroupBooking(tenantId, groupBookingId, true),
      TenantManager.getTenant(tenantId),
    ]);

    if (!groupBooking) {
      throw new NotFoundError("group_booking_not_found", { groupBookingId });
    }
    if (!tenant) {
      throw new NotFoundError("tenant_not_found", { tenantId });
    }

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

    let attachments;
    const cancelledAt = cancellationContext.cancelledAt ?? Date.now();
    const refundCalculations = bookings.map((booking) => ({
      bookingId: booking.id,
      ...CancellationRefundService.calculate({
        tenant,
        booking,
        cancelledAt,
        origin: cancellationContext.origin || CANCELLATION_ORIGINS.SYSTEM,
        refundPercentage: cancellationContext.refundPercentage,
        cancelledByUserId: cancellationContext.cancelledByUserId,
      }),
    }));

    if (groupBooking.getTotalPrice() > 0 && !skipCancellation) {
      const sanitizedBankDetails = sanitizeBankDetails(bankDetails);
      const options = {
        alreadyPaid: groupBooking.areSomeBookingsPaid(),
        cancellationReason: reason,
        refundCalculations,
        bankDetails: sanitizedBankDetails || undefined,
      };

      // The issuance attaches the one document to every member and to
      // these entities, so the state writes below carry it too.
      const { file } = await issueDocument({
        tenantId,
        bookingIds: groupBooking.bookingIds,
        type: "cancellation",
        groupBookingId: groupBooking.id,
        bookings,
        options,
      });

      attachments = mailAttachments(file);
    }

    for (const booking of bookings) {
      const cancelledFrom = cancelledFromOf(booking);
      setStatusFromFlags(booking, { isRejected: true });
      booking.rejectionReason = reason;

      const refundCalculation = refundCalculations.find(
        (calculation) => calculation.bookingId === booking.id,
      );
      if (refundCalculation) {
        const refundAudit = { ...refundCalculation };
        delete refundAudit.bookingId;
        booking.cancellationRefund = refundAudit;
      }
      recordCancelledFrom(booking, cancelledFrom);
      await BookingManager.storeBooking(booking);

      try {
        await AccessService.revokeForBooking(booking.tenantId, booking.id);
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
        attachments,
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
        attachments,
        true,
      );
      logger.info(
        `${tenantId} -- bookings ${groupBooking.bookingIds} canceled and sent booking rejection to ${groupBooking.bookings[0].mail}`,
      );
    }

    return { success: true };
  }

  static async requestRejectBooking(tenant, bookingId, payload = {}) {
    const booking = await BookingManager.getBooking(bookingId, tenant);

    if (!booking) {
      throw new NotFoundError("booking_not_found", { bookingId });
    }

    if (booking.cancellationPolicy?.userCancellable !== true) {
      throw new ForbiddenError("booking_user_cancellation_disabled", {
        bookingId,
      });
    }

    const reason = typeof payload === "string" ? payload : payload.reason || "";
    const sanitizedBankDetails = sanitizeBankDetails(payload?.bankDetails);

    try {
      const hookPayload = { reason };
      if (sanitizedBankDetails) {
        hookPayload.bankDetails = sanitizedBankDetails;
      }

      const hook = booking.addHook(BOOKING_HOOK_TYPES.REJECT, hookPayload);

      await BookingManager.storeBooking(booking);

      const tenantEntity = await TenantManager.getTenant(tenant);
      const refundPreview = this.toCustomerCancellationRefundPreview(
        CancellationRefundService.calculate({
          tenant: tenantEntity,
          booking,
          origin: CANCELLATION_ORIGINS.USER,
        }),
        booking.id,
      );

      await MailController.sendVerifyBookingRejection(
        booking.mail,
        booking.id,
        booking.tenantId,
        hook.id,
        reason,
        undefined,
        refundPreview,
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
    const tenant = await TenantManager.getTenant(tenantId);

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

  /**
   * What stands against reprinting a document for these bookings: the
   * consistency errors of the reprint endpoints (`POST .../receipt`,
   * `.../invoice`), empty when the document may be issued. A receipt needs
   * paid bookings; an invoice needs bookings paying by invoice; a group
   * needs one contact and one state.
   *
   * @param {"receipt"|"invoice"} type
   * @param {Booking[]} bookings One booking, or the members of a group
   * @returns {Object[]} The consistency errors
   */
  static reprintErrors(type, bookings) {
    const groupChecks =
      bookings.length > 1 ? [checkSameContactDetails, checkSameStatus] : [];
    const checks =
      type === "invoice"
        ? [
            ...groupChecks,
            checkSamePaymentProvider,
            checkInvoicePaymentProvider,
          ]
        : [...groupChecks, checkPayedStatus];
    return new BookingConsistencyService(checks).validate(bookings);
  }

  static async verifyBookingOwnership(tenantId, bookingId, name) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);

    if (!booking.id) {
      throw new NotFoundError("booking_not_found", { bookingId });
    }

    return booking.name.toLowerCase() === name.toLowerCase();
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
        const { file } = await issueDocument({
          tenantId,
          bookingIds: [booking.id],
          type: "receipt",
          bookings: [booking],
        });

        attachments = mailAttachments(file);
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

  /**
   * The confirmation of a group: one aggregated receipt where the group is
   * paid, then one mail. `groupBookingId` names the group the receipt is
   * issued for; a caller that does not know it (the payment webhook) leaves
   * it out and the group is looked up by its first booking.
   */
  static async handleAggregatedBookingConfirmation(
    tenantId,
    bookingIds,
    additionalAttachments = [],
    groupBookingId = null,
  ) {
    const bookings = await BookingManager.getBookings(tenantId, bookingIds);

    if (bookings.every((b) => b.isCommitted)) {
      let attachments = [...additionalAttachments];

      const allPayed = bookings.every((b) => b.isPayed);
      const totalPrice = bookings.reduce((acc, b) => acc + b.priceEur, 0);

      if (totalPrice > 0 && allPayed) {
        const { file } = await issueDocument({
          tenantId,
          bookingIds: bookings.map((b) => b.id),
          type: "receipt",
          groupBookingId: await groupBookingIdOf({
            tenantId,
            bookingIds,
            groupBookingId,
          }),
          bookings,
        });

        attachments = mailAttachments(file);
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

  static async getBookingStatus(tenantId, bookingId) {
    const booking = await BookingManager.getBooking(bookingId, tenantId);
    if (!booking) {
      throw new NotFoundError("booking_not_found", { bookingId });
    }
    return booking;
  }

  static async getBookedSeatsCount(tenantId, eventId, params) {
    return await BookingManager.getBookedSeatsCount(tenantId, eventId, params);
  }
}

module.exports = BookingService;
// The mail path is the one caller outside this file that has to be exercised
// on its own: whether `mailAttach` reaches the recipient decides at this seam.
module.exports.prepareMailAttachments = prepareMailAttachments;

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

/**
 * Moves the booking to the state today's flag flip stood for: the flags are
 * derived from `status` now, so the flip is expressed as the state the
 * changed flags read as. The lifecycle transitions of tickets 4 to 6 take
 * this over with their guards.
 */
function setStatusFromFlags(booking, changedFlags) {
  booking.status = statusFromFlags(
    {
      isCommitted: booking.isCommitted,
      isPayed: booking.isPayed,
      isRejected: booking.isRejected,
      ...changedFlags,
    },
    booking.priceEur,
  );
}

/**
 * The state a booking about to be cancelled is cancelled from: its state
 * where that is a live one, else what an earlier cancellation recorded (the
 * admin PUT stores the flip before `rejectBooking` runs, a second rejection
 * finds the booking cancelled already).
 */
function cancelledFromOf(booking) {
  return CANCELLED_FROM_STATUSES.includes(booking.status)
    ? booking.status
    : booking.cancellationRefund?.cancelledFrom;
}

/**
 * A cancelled booking keeps the state it was cancelled from: `reinstate`
 * returns to it and `isPayed` is read from it.
 */
function recordCancelledFrom(booking, cancelledFrom) {
  if (booking.status === STATUS.CANCELLED) {
    booking.cancellationRefund = {
      ...booking.cancellationRefund,
      cancelledFrom,
    };
  }
}

function isNoPaymentRequired(booking) {
  return !booking.priceEur || booking.priceEur === 0 || booking.isPayed;
}

function sanitizeBankDetails(bankDetails) {
  if (!bankDetails || typeof bankDetails !== "object") {
    return null;
  }

  const toTrimmedString = (value) =>
    typeof value === "string" ? value.trim() : "";

  const accountHolder = toTrimmedString(bankDetails.accountHolder);
  const bankName = toTrimmedString(bankDetails.bankName);
  const iban = toTrimmedString(bankDetails.iban)
    .replace(/\s+/g, "")
    .toUpperCase();
  const bic = toTrimmedString(bankDetails.bic)
    .replace(/\s+/g, "")
    .toUpperCase();

  if (!accountHolder && !bankName && !iban && !bic) {
    return null;
  }

  return { accountHolder, bankName, iban, bic };
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
  await notifyOrganizers(tenantId, booking, eventIds);
}
