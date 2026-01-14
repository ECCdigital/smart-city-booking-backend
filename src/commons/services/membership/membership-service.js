const MembershipManager = require("../../data-managers/membership-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const InvitationManager = require("../../data-managers/invitation-manager");
const ChallengeManager = require("../../data-managers/challenge-manager");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "membership-service.js",
  level: process.env.LOG_LEVEL,
});

class MembershipService {
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
