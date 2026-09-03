/**
 * The checkout's hand-over to the booking lifecycle (spec part 1, section
 * 5 and 6; glossary "Aufnahme", "Änderung"): the checkout prepares a
 * booking under its policy, validates it, decides the state it starts in
 * and stores it - then the lifecycle takes over. A new booking is admitted
 * (`bookingLifecycle.admit`, the group `groupBookingLifecycle.admit`);
 * where the admission aborts, the booking is deleted and the coupon given
 * back, so the booking never existed for the customer. An updated booking
 * runs the plan of `update-plan.js`: the amendment, then the transitions
 * the flags of the form ask for, each atomic for itself.
 */

const bunyan = require("bunyan");
const { v4: uuidV4 } = require("uuid");
const BookingManager = require("../../data-managers/booking-manager");
const GroupBookingManager = require("../../data-managers/group-booking-manager");
const CouponService = require("../coupon-service");
const PaymentUtils = require("../../utilities/payment-utils");
const { BookableManager } = require("../../data-managers/bookable-manager");
const { Booking } = require("../../entities/booking/booking");
const { GroupBooking } = require("../../entities/groupBooking/groupBooking");
const { BundleCheckoutService } = require("./bundle-checkout-service");
const checkoutPolicy = require("./checkout-policy");
const { CheckoutPolicy } = checkoutPolicy;
const { CustomFieldService } = require("../custom-field/custom-field-service");
const { CheckoutError } = require("../../../errors/CheckoutError");
const { CHECKOUT_REASONS } = require("./checkout-reasons");
const {
  BadRequestError,
  BaseError,
  ForbiddenError,
  NotFoundError,
} = require("../../../errors/BaseError");
const {
  resolveCheckoutId,
  resolveCheckoutItems,
} = require("../../utilities/checkout-utils");
const {
  bookingLifecycle,
  groupBookingLifecycle,
  LifecycleError,
  TRANSITION,
  TRIGGER,
} = require("../booking-lifecycle");
const { normalizeFlags } = require("../booking-lifecycle/booking-state");
const { planUpdate } = require("../booking-lifecycle/update-plan");
const BookingService = require("./booking-service");

const logger = bunyan.createLogger({
  name: "booking-checkout.js",
  level: process.env.LOG_LEVEL,
});

/** Who admits a booking: the administration under its policy, else the customer. */
function triggerOf(policy) {
  return checkoutPolicy.acceptsAdminOverrides(policy)
    ? TRIGGER.ADMIN
    : TRIGGER.CUSTOMER;
}

/** What made an admission abort: the cause of the lifecycle's error. */
function causeOf(err) {
  return err instanceof LifecycleError ? err.cause : err;
}

async function resolveCheckoutCustomFieldValues({
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

async function assertInvoicePermission(
  tenantId,
  user,
  paymentProvider,
  policy,
) {
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
}

/**
 * The checkout up to the store write (spec part 1, 5.1): the booking is
 * prepared under the policy, validated, stored in its initial state and
 * the coupon consumed. No effect of the lifecycle runs here; the caller
 * admits the booking. With `simulate`, nothing is stored.
 *
 * @param {{ tenantId: string, user?: Object, bookingAttempt: Object, simulate: boolean, policy?: string, checkoutId?: string }} params
 * @returns {Promise<Booking>} The booking as prepared
 */
async function createBooking({
  tenantId,
  user,
  bookingAttempt,
  simulate,
  policy = CheckoutPolicy.SELF_SERVICE,
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

  const customFieldValues = await resolveCheckoutCustomFieldValues({
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

  await assertInvoicePermission(tenantId, user, paymentProvider, policy);

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
    logger.info(
      `${tenantId}, cid ${checkoutId} -- Booking ${booking.id} stored by user ${user?.id} as ${booking.status}`,
    );
  } else {
    logger.info(`${tenantId}, cid ${checkoutId} -- Simulated booking`);
  }
  return booking;
}

/**
 * Takes a stored booking back after an admission that aborted: the
 * booking is removed, its coupon given back. A rollback that fails is
 * logged; the admission's error is the one the caller sees.
 */
async function rollback(tenantId, booking) {
  try {
    await BookingManager.removeBooking(booking.id, tenantId);
    await CouponService.decrementCouponUsage(booking.couponCode, tenantId);
    logger.info(
      `${tenantId} -- booking ${booking.id} rolled back after its admission aborted`,
    );
  } catch (rollbackErr) {
    logger.error(
      `${tenantId} -- rollback failed for booking ${booking.id}: ${rollbackErr.message}`,
    );
  }
}

/**
 * The checkout of a single booking (spec part 1, 5.1): stored, then
 * admitted to the lifecycle with the effects of its initial state. Where
 * the admission aborts - the compartments could not be held - the booking
 * is deleted, the coupon given back and what caused the abort thrown.
 *
 * @param {{ tenantId: string, user?: Object, bookingAttempt: Object, simulate: boolean, policy?: string, checkoutId?: string }} params
 * @returns {Promise<Booking>} The booking as stored after the admission
 */
async function createSingleBooking({
  tenantId,
  user,
  bookingAttempt,
  simulate,
  policy = CheckoutPolicy.SELF_SERVICE,
  checkoutId,
}) {
  const booking = await createBooking({
    tenantId,
    user,
    bookingAttempt,
    simulate,
    policy,
    checkoutId,
  });

  if (simulate) {
    return booking;
  }

  try {
    await bookingLifecycle.admit(tenantId, booking.id, {
      trigger: triggerOf(policy),
    });
  } catch (err) {
    logger.error(
      `${tenantId} -- admission of booking ${booking.id} aborted, rolling back: ${err.message}`,
    );
    await rollback(tenantId, booking);
    throw causeOf(err);
  }

  return await BookingManager.getBooking(booking.id, tenantId);
}

async function generateGroupBookingReference(
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
      return await generateGroupBookingReference(
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
 * The checkout of a group booking (spec part 1, 5.1 and 7): the members
 * are stored one by one in the state the checkout chose, the group over
 * them, then the group is admitted with the effects of that state. Where
 * the admission aborts - a hold failed, or the members start in different
 * states, which the group's guard refuses - every member and the group are
 * deleted, the coupons given back and what caused the abort thrown.
 *
 * @param {{ tenantId: string, user?: Object, contactData: Object, bookingAttempts: Object[], paymentProvider: string, simulate: boolean, policy?: string }} params
 * @returns {Promise<GroupBooking>} The group with its members as stored after the admission
 */
async function createGroupBooking({
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

  await assertInvoicePermission(tenantId, user, paymentProvider, policy);

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

    const booking = await createBooking({
      tenantId,
      user,
      bookingAttempt,
      simulate,
      policy,
    });

    allBookings.push(booking);
  }

  const uniqueId = await generateGroupBookingReference(tenantId);

  const groupBooking = new GroupBooking({
    id: uniqueId,
    tenantId,
    bookingIds: allBookings.map((booking) => booking.id),
    assignedUserId: user?.id,
    mail: contactData.mail,
  });

  await GroupBookingManager.storeGroupBooking(groupBooking);

  if (!simulate) {
    try {
      await groupBookingLifecycle.admit(tenantId, uniqueId, {
        trigger: triggerOf(policy),
      });
    } catch (err) {
      logger.error(
        `${tenantId} -- admission of group booking ${uniqueId} aborted, rolling back: ${err.message}`,
      );
      for (const booking of allBookings) {
        await rollback(tenantId, booking);
      }
      await GroupBookingManager.deleteGroupBooking(tenantId, uniqueId);
      throw causeOf(err);
    }
  }

  return await GroupBookingManager.getGroupBooking(tenantId, uniqueId, true);
}

/**
 * One transition of an update plan, as the administration (glossary
 * "Auslöser"). The confirmation keeps its consistency check in front,
 * whose refusal is the 400 of before; the cancellation of a flipped flag
 * refunds in full, the form carrying no percentage, and names the user
 * who flipped it.
 */
async function runUpdateTransition(tenantId, transition, { booking, userId }) {
  const trigger = TRIGGER.ADMIN;
  switch (transition) {
    case TRANSITION.AMEND:
      await bookingLifecycle.amend(tenantId, booking, { trigger });
      return;
    case TRANSITION.CONFIRM: {
      const errors = BookingService.transitionErrors(transition, [booking]);
      if (errors.length > 0) {
        throw new BadRequestError(errors[0].code, { errors });
      }
      await bookingLifecycle.confirm(tenantId, booking.id, { trigger });
      return;
    }
    case TRANSITION.PAY:
      await bookingLifecycle.pay(tenantId, booking.id, {
        trigger,
        paymentMethod: booking.paymentMethod,
        timePaid: booking.timePaid,
      });
      return;
    case TRANSITION.CANCEL:
      await bookingLifecycle.cancel(tenantId, booking.id, {
        trigger,
        reason: booking.rejectionReason,
        refundPercentage: 100,
        cancelledByUserId: userId,
      });
      return;
    case TRANSITION.REINSTATE:
      await bookingLifecycle.reinstate(tenantId, booking.id, { trigger });
      return;
    default:
      throw new Error(`updateBooking: no way to run ${transition}`);
  }
}

/**
 * The admin PUT as the plan of spec part 1, section 6: the checkout
 * prepares the booking as it is to be (a manual booking, see CONTEXT.md),
 * `planUpdate` reads the three flags of the form against the state the
 * booking is in and answers the transitions the update needs - `amend`
 * first, the content change, then what the flags ask for - and each runs
 * for itself, atomic, in order. There is no rollback across transitions:
 * where transition k fails, 1..k-1 stand and the error of k is the
 * answer. Flags no sequence of transitions reaches are refused with
 * `BadRequestError invalid_status_change` before anything is written.
 *
 * The plan runs here, next to the preparation, because it reads the
 * price the booking has after the update, which the checkout decides.
 *
 * @param {string} tenantId
 * @param {Object} updatedBooking The booking as the form sends it
 * @param {{ requestBody?: Object, userId?: string|null }} [options] The
 *   form as it was sent, whose three flags the plan reads (the entity
 *   derives its flags from the state it read off them, so "paid but not
 *   confirmed" is not visible on it any more), and the user updating,
 *   named at the cancellation the plan runs
 * @returns {Promise<Booking>} The booking as it is stored afterwards
 * @throws {NotFoundError} `booking_not_found`
 * @throws {BadRequestError} `invalid_status_change`, or the code of a
 *   consistency check that refused a confirmation
 */
async function updateBooking(
  tenantId,
  updatedBooking,
  { requestBody = updatedBooking, userId = null } = {},
) {
  const oldBooking = await BookingManager.getBooking(
    updatedBooking.id,
    tenantId,
  );

  if (!oldBooking) {
    throw new NotFoundError("booking_not_found", {
      bookingId: updatedBooking.id,
    });
  }

  const flags = normalizeFlags(requestBody);
  const onUnreject = oldBooking.isRejected && !flags.isRejected;

  const { checkoutId } = await resolveCheckoutId(
    undefined,
    oldBooking.assignedUserId,
    tenantId,
  );

  // Every booking update is a manual booking (see CONTEXT.md,
  // "Manuelle Buchung"): the entered values are authoritative, no checks
  // run and no automatic discounts apply. The flags of the form are the
  // plan's, not the checkout's: the content write goes in the state the
  // booking is in, so the checkout prepares it without them.
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
        updatedBooking.internalComments || oldBooking.internalComments || "",
      rejectionReason:
        updatedBooking.rejectionReason || oldBooking.rejectionReason || "",
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
    // The reinstatement keeps price, positions and coupon of before the
    // cancellation (spec part 1, 4.2): the content write carries them,
    // `reinstate` clears the reason and takes the refund audit away.
    booking.priceEur = oldBooking.priceEur;
    booking.vatIncludedEur = oldBooking.vatIncludedEur;
    booking.bookableItems = oldBooking.bookableItems;
    booking.couponCode = oldBooking.couponCode;
    booking._couponUsed = oldBooking._couponUsed;
    booking.rejectionReason = oldBooking.rejectionReason || "";
  }

  // The content write goes in the state the plan is made for.
  booking.status = oldBooking.status;
  booking.validate();

  const plan = planUpdate(oldBooking.status, flags, booking.priceEur, {
    cancelledFrom: oldBooking.cancellationRefund?.cancelledFrom,
  });

  for (const transition of plan) {
    await runUpdateTransition(tenantId, transition, { booking, userId });
  }

  const onlyAmended = plan.length === 1;
  return onlyAmended
    ? booking
    : await BookingManager.getBooking(booking.id, tenantId);
}

module.exports = {
  createBooking,
  createSingleBooking,
  createGroupBooking,
  updateBooking,
};
