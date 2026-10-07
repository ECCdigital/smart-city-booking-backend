const {
  CHECKOUT_REASONS,
  REASON_BY_CHECK_TYPE,
} = require("./checkout-reasons");

/**
 * Maps a raw check error (thrown by ItemCheckoutService) to its reason
 * code: the reason the check named itself, otherwise the default reason
 * for that checkType.
 */
function resolveReason(rawErr) {
  const { checkType, reason } = rawErr;

  if (typeof reason === "string" && reason) return reason;

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
 *
 * The bookings a capacity check counted (`concurrentBookings`) stay
 * behind: they are bookings of others, and the answer goes to whoever
 * asks, the anonymous included (ECCdigital/tickets#260).
 */
function normalizeCheckError(err) {
  if (err && typeof err === "object" && err.checkType) {
    const {
      checkType,
      message,
      /* eslint-disable no-unused-vars */
      available,
      reason: _reason,
      concurrentBookings: _concurrentBookings,
      /* eslint-enable no-unused-vars */
      ...rest
    } = err;

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
