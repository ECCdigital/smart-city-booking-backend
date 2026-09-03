/**
 * The queries of a booking (spec part 1, 10.4): what the API reads off a
 * booking or a group without changing it - the refund previews of a
 * cancellation, the public status view, the ownership check, the booked
 * seats of an event - and the consistency checks that stand in front of a
 * lifecycle transition or a reprint with their own answer form. The
 * checkout lives in `booking-checkout.js`, the transitions in
 * `booking-lifecycle/`, the deletion in `booking-lifecycle/booking-deletion.js`.
 */

const BookingManager = require("../../data-managers/booking-manager");
const GroupBookingManager = require("../../data-managers/group-booking-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const { BOOKING_HOOK_TYPES } = require("../../entities/booking/bookingHook");
const {
  BookingConsistencyService,
  checkSameContactDetails,
  checkSameStatus,
  checkSamePaymentProvider,
  checkInvoicePaymentProvider,
  checkPayedStatus,
  validatePaymentProviderRequirement,
} = require("../booking-consitency-service");
const { TRANSITION } = require("../booking-lifecycle/booking-state");
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

class BookingService {
  /**
   * The consistency checks a transition runs in front of the lifecycle's
   * guard, with their `{ success: false, errors }` answer of before (spec
   * part 2, section 9 and the notes on tickets 5 and 8): a priced booking
   * needs a payment provider to be confirmed; a group needs one contact,
   * one state and, for its confirmation, one payment provider. The state
   * guard of the lifecycle closes the race behind them.
   *
   * @param {string} transition `confirm` or `cancel`
   * @param {Object[]} bookings One booking, or the members of a group
   * @returns {Object[]} The consistency errors, empty where the transition may run
   */
  static transitionErrors(transition, bookings) {
    const group = bookings.length > 1;
    const groupChecks = group ? [checkSameContactDetails, checkSameStatus] : [];
    const checks =
      transition === TRANSITION.CONFIRM
        ? [
            ...groupChecks,
            ...(group ? [checkSamePaymentProvider] : []),
            validatePaymentProviderRequirement,
          ]
        : groupChecks;
    return new BookingConsistencyService(checks).validate(bookings);
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

    return CancellationRefundService.toCustomerPreview(calculation, bookingId);
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
