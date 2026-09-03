/**
 * The recipients of a notice (glossary "Empfängerkreis"; mail-stack spec,
 * section 2.5), resolved from what the loader read: the booker, the
 * tenant behind its gate, the supervisors named at the booker's
 * membership, the organizers of the events the tickets belong to, or the
 * address the caller named. An empty circle is a valid answer - no mail,
 * no error.
 */

const bunyan = require("bunyan");
const { isEmail } = require("validator");
const MembershipManager = require("../data-managers/membership-manager");
const UserManager = require("../data-managers/user-manager");
const { normalizeUserId } = require("../utilities/user-id-utils");
const {
  isValidBookingNotificationRecipient,
} = require("../utilities/booking-notification-utils");

const logger = bunyan.createLogger({
  name: "mail-recipients.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Resolves the recipient entries of a membership
 * (`bookingNotificationRecipients`) into a deduplicated list of e-mail
 * addresses. Invalid or dangling references (deleted users or roles) are
 * skipped with a warning and never block the remaining resolution.
 *
 * @param {string} tenantId
 * @param {Array} recipients Recipient entries from a membership
 * @param {Object} [options]
 * @param {string[]} [options.excludeEmails] Addresses to leave out (the booker)
 * @returns {Promise<string[]>} Deduplicated, valid e-mail addresses
 */
async function resolveRecipientEmails(
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
        activeMemberships.forEach((membership) => addEmail(membership.userId));
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
 * The supervisors of a booking: the recipients named at the booker's
 * membership, where the tenant wants supervisors told; none for a guest
 * booking, and never the booker.
 */
async function supervisorEmails({ tenantId, tenant, bookings }) {
  const userId = bookings[0].assignedUserId;
  if (!userId || !tenant.notifySupervisorsOnBooking) {
    return [];
  }
  const membership = await MembershipManager.getMembershipByTenantAndUserID(
    tenantId,
    userId,
  );
  const recipients = membership?.bookingNotificationRecipients || [];
  if (recipients.length === 0) {
    return [];
  }
  return resolveRecipientEmails(tenantId, recipients, {
    excludeEmails: [userId, bookings[0].mail],
  });
}

/**
 * The organizers of the events the ticket positions of the bookings belong
 * to, once each.
 */
function organizerEmails({ bookables, events }) {
  const addresses = bookables
    .filter((bookable) => bookable.type === "ticket" && bookable.eventId)
    .map(
      (bookable) =>
        events.get(bookable.eventId)?.eventOrganizer?.contactPersonEmailAddress,
    )
    .filter((email) => isEmail(email ?? ""));
  return [...new Set(addresses)];
}

/**
 * The recipients of a notice of the given type over what the loader read.
 *
 * @param {Object} mailType The registry entry
 * @param {Object} loaded `{ tenantId, tenant, bookings, bookables, events, ctx }`
 * @returns {Promise<string[]>} The addresses, none where the circle is empty
 */
async function resolveRecipients(mailType, loaded) {
  switch (mailType.audience) {
    case "booker":
      return [loaded.bookings[0].mail].filter(Boolean);
    case "tenant":
      if (mailType.gate && !mailType.gate({ tenant: loaded.tenant })) {
        return [];
      }
      return [loaded.tenant.mail].filter(Boolean);
    case "supervisors":
      return supervisorEmails(loaded);
    case "organizers":
      return organizerEmails(loaded);
    case "named":
      return [loaded.ctx.to].filter(Boolean);
    default:
      throw new Error(
        `mail-service: unknown audience ${mailType.audience} of ${mailType.templateName}`,
      );
  }
}

module.exports = { resolveRecipients, resolveRecipientEmails };
