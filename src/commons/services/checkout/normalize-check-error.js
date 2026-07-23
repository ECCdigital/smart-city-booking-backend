const {
  CHECKOUT_REASONS,
  REASON_BY_CHECK_TYPE,
} = require("./checkout-reasons");
const { CHECK_TYPES } = require("./item-checkout-service");

/**
 * Maps a raw check error (thrown by ItemCheckoutService) to a more
 * specific reason code when possible, otherwise falls back to the
 * default reason for that checkType.
 */
function resolveReason(rawErr) {
  const { checkType, message } = rawErr;

  if (
    checkType === CHECK_TYPES.BOOKING_DURATION &&
    typeof message === "string"
  ) {
    if (message.includes("mindestens"))
      return CHECKOUT_REASONS.DURATION_TOO_SHORT;
    if (message.includes("nicht überschreiten"))
      return CHECKOUT_REASONS.DURATION_TOO_LONG;
  } else if (
    checkType === CHECK_TYPES.PERMISSION &&
    typeof message === "string"
  ) {
    if (message.includes("nicht buchbar"))
      return CHECKOUT_REASONS.BOOKABLE_NOT_BOOKABLE;
  }

  return REASON_BY_CHECK_TYPE[checkType] || CHECKOUT_REASONS.UNKNOWN;
}

/**
 * Sanitizes a thrown check error into a frontend-friendly payload:
 *   { reason, checkType, params, debugMessage }
 *
 * - `reason` is a stable i18n key
 * - `params` contains structured data the frontend can interpolate
 *   (e.g. {title}, {remaining}, {totalCapacity})
 * - `debugMessage` is the original German message — only for logs/debug.
 */
function normalizeCheckError(err) {
  if (err && typeof err === "object" && err.checkType) {
    const { checkType, message, available, ...rest } = err;

    return {
      reason: resolveReason(err),
      checkType,
      params: rest,
      debugMessage: message,
    };
  }

  return {
    reason: CHECKOUT_REASONS.UNKNOWN,
    checkType: null,
    params: {},
    debugMessage: err?.message || "Unknown error",
  };
}

module.exports = { normalizeCheckError, resolveReason };
