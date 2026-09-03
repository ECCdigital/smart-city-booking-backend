const {
  STATUS,
  statusFromFlags,
} = require("../booking-lifecycle/booking-state");

/**
 * Stable i18n keys for resolved booking status (frontend).
 * Do not rename without coordinating with the frontend.
 */
const BOOKING_STATUS_I18N = {
  AWAITING_APPROVAL: "status.awaiting_approval",
  PAYMENT_EXPECTED: "status.payment_expected",
  PAID_COMPLETED: "status.paid_completed",
  REJECTED: "status.rejected",
  /** Committed (and not rejected), no payable amount or no payment step required */
  CONFIRMED_WITHOUT_PAYMENT: "status.confirmed_without_payment",
};

/**
 * API-level error reason codes (i18n-friendly), used when success: false.
 */
const BOOKING_STATUS_REASONS = {
  MISSING_PARAMETERS: "booking_status.missing_parameters",
  INTERNAL_ERROR: "booking_status.internal_error",
  BOOKING_NOT_FOUND: "booking_status.booking_not_found",
};

/**
 * Maps a booking to a frontend i18n status key, read off `booking.status`;
 * a plain object that still speaks in flags is read the way the entity
 * reads it.
 * @param {{ status?: string, isCommitted?: boolean, isPayed?: boolean, isRejected?: boolean, priceEur?: number }} booking
 * @returns {string}
 */
function resolveBookingStatusKey(booking) {
  const priceEur = Number(booking.priceEur) || 0;
  const status = booking.status || statusFromFlags(booking, priceEur);

  switch (status) {
    case STATUS.REJECTED:
    case STATUS.CANCELLED:
      return BOOKING_STATUS_I18N.REJECTED;
    case STATUS.REQUESTED:
      return BOOKING_STATUS_I18N.AWAITING_APPROVAL;
    case STATUS.PAYMENT_DUE:
      return BOOKING_STATUS_I18N.PAYMENT_EXPECTED;
    default:
      return priceEur > 0
        ? BOOKING_STATUS_I18N.PAID_COMPLETED
        : BOOKING_STATUS_I18N.CONFIRMED_WITHOUT_PAYMENT;
  }
}

module.exports = {
  BOOKING_STATUS_I18N,
  BOOKING_STATUS_REASONS,
  resolveBookingStatusKey,
};
