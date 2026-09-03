const MembershipManager = require("../../data-managers/membership-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const InvitationManager = require("../../data-managers/invitation-manager");
const ChallengeManager = require("../../data-managers/challenge-manager");
const UserManager = require("../../data-managers/user-manager");
const { RoleManager } = require("../../data-managers/role-manager");
const {
  MAX_BOOKING_NOTIFICATION_RECIPIENTS,
  isValidBookingNotificationRecipient,
  sanitizeBookingNotificationRecipients,
} = require("../../utilities/booking-notification-utils");
const { BadRequestError } = require("../../../errors/BaseError");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "membership-service.js",
  level: process.env.LOG_LEVEL,
});

class MembershipService {
  /**
   * The write side of the supervisors (glossary "Aufsicht"): validates and
   * normalizes the `bookingNotificationRecipients` of a membership before
   * they are stored - the structure and the count of the entries, the
   * user or the role in the tenant an entry refers to - and drops
   * duplicates. Resolving them into addresses is the mail module's
   * (`mail-service/recipients.js`).
   *
   * @param {string} tenantId
   * @param {Array} recipients - Raw recipient entries from the request
   * @returns {Promise<Array>} Sanitized and deduplicated recipient entries
   * @throws {BadRequestError} When any entry is invalid
   */
  static async prepareBookingNotificationRecipients(tenantId, recipients) {
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

  static async getPendingMembershipByUserId(userId) {
    const memberships = await MembershipManager.getMembershipsByUserID(userId);
    return (memberships || []).filter((m) => m?.status === "pending");
  }

  static async getPendingApprovalMembershipsByUserId(userId) {
    const memberships = await MembershipManager.getMembershipsByUserID(userId);
    if (!memberships?.length) return [];

    const pending = memberships.filter(
      (m) =>
        m?.invitations?.some((i) => i?.status === "pending_approval") &&
        m?.status !== "suspended",
    );
    if (!pending.length) return [];

    const tenantCache = new Map();
    const invitationCache = new Map();
    const challengeCache = new Map();

    const membershipResults = await Promise.all(
      pending.map(async (m) => {
        try {
          let tenant = tenantCache.get(m.tenantId);
          if (!tenant) {
            tenant = await TenantManager.getTenant(m.tenantId);
            if (tenant) tenantCache.set(m.tenantId, tenant);
          }
          if (!tenant) return null;

          const pendingInvites = m.invitations.filter(
            (i) => i.status === "pending_approval",
          );

          let instructions = null;
          let requiresManualApproval = false;

          for (const inv of pendingInvites) {
            let iv = invitationCache.get(inv.token);
            if (!iv) {
              iv = await InvitationManager.getInvitationByToken(inv.token);
              if (iv) invitationCache.set(inv.token, iv);
            }
            if (!iv?.challenges?.length) continue;

            for (const chId of iv.challenges) {
              const key = `${m.tenantId}:${chId}`;
              let ch = challengeCache.get(key);
              if (!ch) {
                ch = await ChallengeManager.getChallengeByID(m.tenantId, chId);
                if (ch) challengeCache.set(key, ch);
              }
              if (ch?.key === "manualApproval") {
                requiresManualApproval = true;
                instructions = ch?.defaultConfig?.instructions ?? null;
                break;
              }
            }
            if (requiresManualApproval) break;
          }

          if (!requiresManualApproval) return null;

          return {
            tenantId: m.tenantId,
            tenantName: tenant.name,
            instructions,
          };
        } catch (err) {
          logger.error(
            { err, membership: m },
            "Error processing pending approval membership",
          );
          return null;
        }
      }),
    );

    const byTenant = new Map();
    for (const r of membershipResults) {
      if (!r) continue;
      if (!byTenant.has(r.tenantId)) {
        byTenant.set(r.tenantId, r);
      }
    }

    return Array.from(byTenant.values());
  }
}

module.exports = MembershipService;
