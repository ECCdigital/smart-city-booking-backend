const bunyan = require("bunyan");
const { isEmail } = require("validator");
const TenantManager = require("../data-managers/tenant-manager");
const MembershipManager = require("../data-managers/membership-manager");
const UserManager = require("../data-managers/user-manager");
const { RoleManager } = require("../data-managers/role-manager");
const BookingManager = require("../data-managers/booking-manager");
const MailController = require("../mail-service/mail-controller");
const { normalizeUserId } = require("../utilities/user-id-utils");
const {
  MAX_BOOKING_NOTIFICATION_RECIPIENTS,
  isValidBookingNotificationRecipient,
  sanitizeBookingNotificationRecipients,
} = require("../utilities/booking-notification-utils");
const { BadRequestError } = require("../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "supervisor-notification-service.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Service for supervisor booking notifications.
 *
 * Resolves the `bookingNotificationRecipients` configured on a booker's
 * membership into a deduplicated list of e-mail addresses and dispatches
 * the supervisor notification mail after a booking has been created.
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

  /**
   * Resolves configured recipient entries into a deduplicated list of
   * e-mail addresses. Invalid or dangling references (deleted users/roles)
   * are skipped with a warning and never block the remaining resolution.
   *
   * @param {string} tenantId
   * @param {Array} recipients - Recipient entries from a membership
   * @param {object} [options]
   * @param {string[]} [options.excludeEmails] - Addresses to remove from the result (e.g. the booker)
   * @returns {Promise<string[]>} Deduplicated, valid e-mail addresses
   */
  static async resolveRecipientEmails(
    tenantId,
    recipients,
    { excludeEmails = [] } = {},
  ) {
    const excluded = new Set(
      excludeEmails.filter(Boolean).map((email) => normalizeUserId(email)),
    );
    const resolved = new Set();

    const addEmail = (value) => {
      const email = normalizeUserId(value);
      if (email && isEmail(email) && !excluded.has(email)) {
        resolved.add(email);
      }
    };

    for (const entry of recipients || []) {
      try {
        if (!isValidBookingNotificationRecipient(entry)) {
          logger.warn(
            `${tenantId} -- Skipping invalid booking notification recipient: ${JSON.stringify(entry)}`,
          );
          continue;
        }

        if (entry.type === "email") {
          addEmail(entry.value);
        } else if (entry.type === "user") {
          const existingUser = await UserManager.getUser(entry.value);
          if (!existingUser) {
            logger.warn(
              `${tenantId} -- Skipping booking notification recipient, user not found: ${entry.value}`,
            );
            continue;
          }
          addEmail(entry.value);
        } else if (entry.type === "role") {
          const memberships =
            await MembershipManager.getMembershipsByTenantAndRoles(tenantId, [
              entry.value,
            ]);
          const activeMemberships = (memberships || []).filter(
            (membership) => membership.status === "active",
          );
          if (activeMemberships.length === 0) {
            logger.warn(
              `${tenantId} -- Booking notification role recipient resolved to no active members: ${entry.value}`,
            );
            continue;
          }
          activeMemberships.forEach((membership) =>
            addEmail(membership.userId),
          );
        }
      } catch (err) {
        logger.warn(
          `${tenantId} -- Error resolving booking notification recipient ${JSON.stringify(entry)}: ${err.message}`,
        );
      }
    }

    return [...resolved];
  }

  /**
   * Sends supervisor notifications for a newly created booking (single or
   * aggregated group booking). Never throws; failures are logged so the
   * booking flow is not blocked.
   *
   * @param {object} params
   * @param {string} params.tenantId
   * @param {string} params.userId - The booker's user id (empty for guest bookings)
   * @param {string|string[]} params.bookingIds
   * @param {boolean} [params.aggregated] - true for group bookings (one aggregated mail)
   * @returns {Promise<void>}
   */
  static async notifySupervisorsOnBookingCreated({
    tenantId,
    userId,
    bookingIds,
    aggregated = false,
  }) {
    try {
      if (!userId) {
        // Guest booking without logged-in user: no supervisor notification
        return;
      }

      const ids = (
        Array.isArray(bookingIds) ? bookingIds : [bookingIds]
      ).filter(Boolean);
      if (ids.length === 0) return;

      const tenant = await TenantManager.getTenant(tenantId);
      if (!tenant?.notifySupervisorsOnBooking) return;

      const membership = await MembershipManager.getMembershipByTenantAndUserID(
        tenantId,
        userId,
      );
      const recipients = membership?.bookingNotificationRecipients || [];
      if (recipients.length === 0) return;

      const booking = await BookingManager.getBooking(ids[0], tenantId);

      const emails = await this.resolveRecipientEmails(tenantId, recipients, {
        excludeEmails: [userId, booking?.mail],
      });

      for (const address of emails) {
        try {
          await MailController.sendSupervisorBookingNotification(
            address,
            ids,
            tenantId,
            aggregated,
          );
        } catch (err) {
          logger.warn(
            `${tenantId} -- Could not send supervisor booking notification to ${address}: ${err.message}`,
          );
        }
      }

      if (emails.length > 0) {
        logger.info(
          `${tenantId} -- Sent supervisor booking notifications for booking(s) ${ids.join(", ")} to ${emails.length} recipient(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `${tenantId} -- Error while sending supervisor booking notifications: ${err.message}`,
      );
    }
  }
}

module.exports = SupervisorNotificationService;
