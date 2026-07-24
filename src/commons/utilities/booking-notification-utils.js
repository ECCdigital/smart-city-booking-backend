const { isEmail } = require("validator");

const BOOKING_NOTIFICATION_RECIPIENT_TYPES = Object.freeze([
  "user",
  "role",
  "email",
]);

const MAX_BOOKING_NOTIFICATION_RECIPIENTS = 10;

/**
 * Structural validation of a single booking notification recipient entry.
 *
 * @param {object} entry - Recipient entry ({ type, value, label? })
 * @returns {boolean}
 */
function isValidBookingNotificationRecipient(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }

  if (!BOOKING_NOTIFICATION_RECIPIENT_TYPES.includes(entry.type)) {
    return false;
  }

  if (typeof entry.value !== "string" || entry.value.trim() === "") {
    return false;
  }

  if (
    entry.label !== undefined &&
    entry.label !== null &&
    typeof entry.label !== "string"
  ) {
    return false;
  }

  if (
    (entry.type === "email" || entry.type === "user") &&
    !isEmail(entry.value.trim())
  ) {
    return false;
  }

  return true;
}

/**
 * Validator compatible with the SchemaUtils custom `validate` hook.
 * Returns true when valid, otherwise a SchemaUtils error code key.
 *
 * @param {Array} value - bookingNotificationRecipients value
 * @returns {true|string}
 */
function validateBookingNotificationRecipients(value) {
  if (value === undefined || value === null) return true;
  if (!Array.isArray(value)) return "validate";
  if (value.length > MAX_BOOKING_NOTIFICATION_RECIPIENTS) return "maxItems";
  return value.every(isValidBookingNotificationRecipient) ? true : "validate";
}

/**
 * Normalize recipient entries for persistence
 * (trimming, lowercasing of user IDs / emails, whitelisted keys only).
 *
 * @param {Array} recipients
 * @returns {Array<{type: string, value: string, label: string}>}
 */
function sanitizeBookingNotificationRecipients(recipients = []) {
  return (recipients || []).map((entry) => {
    const value = String(entry.value || "").trim();
    return {
      type: entry.type,
      value: entry.type === "role" ? value : value.toLowerCase(),
      label: typeof entry.label === "string" ? entry.label.trim() : "",
    };
  });
}

module.exports = {
  BOOKING_NOTIFICATION_RECIPIENT_TYPES,
  MAX_BOOKING_NOTIFICATION_RECIPIENTS,
  isValidBookingNotificationRecipient,
  validateBookingNotificationRecipients,
  sanitizeBookingNotificationRecipients,
};
