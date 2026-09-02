const { CHECK_TYPES } = require("../../availability/checkout-check-types");

/**
 * Stable reason codes used as i18n keys in the frontend.
 * NEVER rename these without coordinating with the frontend.
 */
const CHECKOUT_REASONS = {
  // generic / request
  MISSING_PARAMETERS: "checkout.missing_parameters",
  UNAUTHORIZED: "checkout.unauthorized",
  LOGIN_REQUIRED: "checkout.login_required",
  PERMISSION_DENIED: "checkout.permission_denied",
  BAD_REQUEST: "checkout.bad_request",
  CUSTOM_FIELDS_INVALID: "checkout.custom_fields_invalid",
  UNKNOWN: "checkout.unknown",

  // bookable
  BOOKABLE_NOT_FOUND: "checkout.bookable_not_found",
  BOOKABLE_NOT_BOOKABLE: "checkout.bookable_not_bookable",
  BOOKABLE_UNAVAILABLE: "checkout.bookable_unavailable",
  PARENT_UNAVAILABLE: "checkout.parent_unavailable",
  CHILD_UNAVAILABLE: "checkout.child_unavailable",

  // time / duration
  OUTSIDE_OPENING_HOURS: "checkout.outside_opening_hours",
  DURATION_TOO_SHORT: "checkout.duration_too_short",
  DURATION_TOO_LONG: "checkout.duration_too_long",
  DURATION_INVALID: "checkout.duration_invalid",
  BLOCK_PERIOD_MISMATCH: "checkout.block_period_mismatch",
  TIME_PERIOD_MISMATCH: "checkout.time_period_mismatch",
  TIME_REQUIRED: "checkout.time_required",
  MAX_BOOKING_DATE_EXCEEDED: "checkout.max_booking_date_exceeded",

  // event
  EVENT_IN_PAST: "checkout.event_in_past",
  EVENT_FULL: "checkout.event_full",
  EVENT_NOT_FOUND: "checkout.event_not_found",

  // pricing / amount
  NO_PRICE_CATEGORY: "checkout.no_price_category",
  MAX_AMOUNT_EXCEEDED: "checkout.max_amount_exceeded",

  // group booking
  BOOKING_ATTEMPTS_MISSING: "checkout.booking_attempts_missing",
  INVALID_BOOKABLE_ITEMS: "checkout.invalid_bookable_items",
  GROUP_BOOKING_DISABLED: "checkout.group_booking_disabled",
  GROUP_BOOKING_ROLE_REQUIRED: "checkout.group_booking_role_required",

  // payment (triggered as part of v2 checkout)
  LOCKER_UNAVAILABLE: "checkout.locker_unavailable",
  PAYMENT_PROVIDER_UNAVAILABLE: "checkout.payment_provider_unavailable",
  PAYMENT_FAILED: "checkout.payment_failed",
};

/**
 * Default mapping CHECK_TYPE -> reason code.
 * Used as a fallback when a check throws without naming a `reason`.
 * A check that can distinguish more than one cause (duration too short
 * vs. too long, not bookable vs. not permitted) sets `reason` itself.
 */
const REASON_BY_CHECK_TYPE = {
  [CHECK_TYPES.PERMISSION]: CHECKOUT_REASONS.PERMISSION_DENIED,
  [CHECK_TYPES.AVAILABILITY]: CHECKOUT_REASONS.BOOKABLE_UNAVAILABLE,
  [CHECK_TYPES.PARENT_AVAILABILITY]: CHECKOUT_REASONS.PARENT_UNAVAILABLE,
  [CHECK_TYPES.CHILD_BOOKINGS]: CHECKOUT_REASONS.CHILD_UNAVAILABLE,
  [CHECK_TYPES.OPENING_HOURS]: CHECKOUT_REASONS.OUTSIDE_OPENING_HOURS,
  [CHECK_TYPES.BOOKING_DURATION]: CHECKOUT_REASONS.DURATION_INVALID,
  [CHECK_TYPES.BLOCK_PERIOD]: CHECKOUT_REASONS.BLOCK_PERIOD_MISMATCH,
  [CHECK_TYPES.TIME_PERIOD]: CHECKOUT_REASONS.TIME_PERIOD_MISMATCH,
  [CHECK_TYPES.EVENT_DATE]: CHECKOUT_REASONS.EVENT_IN_PAST,
  [CHECK_TYPES.EVENT_SEATS]: CHECKOUT_REASONS.EVENT_FULL,
  [CHECK_TYPES.MAX_BOOKING_DATE]: CHECKOUT_REASONS.MAX_BOOKING_DATE_EXCEEDED,
  [CHECK_TYPES.TIME_RELATION]: CHECKOUT_REASONS.TIME_REQUIRED,
  [CHECK_TYPES.PRICE_CATEGORY]: CHECKOUT_REASONS.NO_PRICE_CATEGORY,
  [CHECK_TYPES.MAX_AMOUNT]: CHECKOUT_REASONS.MAX_AMOUNT_EXCEEDED,
};

module.exports = { CHECKOUT_REASONS, REASON_BY_CHECK_TYPE };
