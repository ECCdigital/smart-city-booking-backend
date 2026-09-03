const UserManager = require("../data-managers/user-manager");
const { RoleManager } = require("../data-managers/role-manager");
const {
  MAX_BOOKING_NOTIFICATION_RECIPIENTS,
  isValidBookingNotificationRecipient,
  sanitizeBookingNotificationRecipients,
} = require("../utilities/booking-notification-utils");
const { BadRequestError } = require("../../errors/BaseError");

/**
 * The write side of the supervisor recipients: validates the
 * `bookingNotificationRecipients` of a membership before they are stored.
 * Resolving them into addresses and sending the supervisors' notice is the
 * mail module's (`mail-service/recipients.js`, `SUPERVISOR_BOOKING_NOTIFICATION`).
 */
class SupervisorNotificationService {
  /**
   * Validates and normalizes recipient entries before they are persisted
   * on a membership. Performs structural checks as well as referential
   * checks (user exists / role exists in tenant).
   *
   * @param {string} tenantId
   * @param {Array} recipients - Raw recipient entries from the request
   * @returns {Promise<Array>} Sanitized and deduplicated recipient entries
   * @throws {BadRequestError} When any entry is invalid
   */
  static async prepareRecipientsForWrite(tenantId, recipients) {
    if (!Array.isArray(recipients)) {
      throw new BadRequestError("invalid_booking_notification_recipients");
    }

    if (recipients.length > MAX_BOOKING_NOTIFICATION_RECIPIENTS) {
      throw new BadRequestError("too_many_booking_notification_recipients", {
        max: MAX_BOOKING_NOTIFICATION_RECIPIENTS,
      });
    }

    for (const entry of recipients) {
      if (!isValidBookingNotificationRecipient(entry)) {
        throw new BadRequestError("invalid_booking_notification_recipient", {
          entry,
        });
      }
    }

    const sanitized = sanitizeBookingNotificationRecipients(recipients);

    for (const entry of sanitized) {
      if (entry.type === "user") {
        const existingUser = await UserManager.getUser(entry.value);
        if (!existingUser) {
          throw new BadRequestError(
            "booking_notification_recipient_user_not_found",
            { value: entry.value },
          );
        }
      } else if (entry.type === "role") {
        const role = await RoleManager.getRole(entry.value, tenantId);
        if (!role) {
          throw new BadRequestError(
            "booking_notification_recipient_role_not_found",
            { value: entry.value },
          );
        }
      }
    }

    const seen = new Set();
    return sanitized.filter((entry) => {
      const key = `${entry.type}:${entry.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

module.exports = SupervisorNotificationService;
