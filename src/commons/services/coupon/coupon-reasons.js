/**
 * Stable reason codes for coupon validation (e.g. i18n keys on the client).
 */
const COUPON_REASONS = {
  MISSING_PARAMETERS: "coupon.missing_parameters",
  NOT_FOUND: "coupon.not_found",
  EXPIRED: "coupon.expired",
  NOT_YET_VALID: "coupon.not_yet_valid",
  MAX_REDEMPTIONS_REACHED: "coupon.max_redemptions_reached",
  UNAVAILABLE: "coupon.unavailable",
  INTERNAL_ERROR: "coupon.internal_error",
};

module.exports = { COUPON_REASONS };
