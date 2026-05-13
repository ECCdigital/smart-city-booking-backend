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
 * Maps a booking entity to a frontend i18n status key.
 * @param {{ isCommitted?: boolean, isPayed?: boolean, isRejected?: boolean, priceEur?: number }} booking
 * @returns {string}
 */
function resolveBookingStatusKey(booking) {
  const priceEur = Number(booking.priceEur) || 0;
  const isCommitted = Boolean(booking.isCommitted);
  const isPayed = Boolean(booking.isPayed);
  const isRejected = Boolean(booking.isRejected);

  if (isRejected) {
    return BOOKING_STATUS_I18N.REJECTED;
  }
  if (!isCommitted) {
    return BOOKING_STATUS_I18N.AWAITING_APPROVAL;
  }
  if (isCommitted && !isPayed && priceEur > 0) {
    return BOOKING_STATUS_I18N.PAYMENT_EXPECTED;
  }
  if (isCommitted && isPayed && priceEur > 0) {
    return BOOKING_STATUS_I18N.PAID_COMPLETED;
  }
  return BOOKING_STATUS_I18N.CONFIRMED_WITHOUT_PAYMENT;
}

module.exports = {
  BOOKING_STATUS_I18N,
  BOOKING_STATUS_REASONS,
  resolveBookingStatusKey,
};
