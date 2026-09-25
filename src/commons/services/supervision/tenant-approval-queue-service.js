/**
 * The tenant approval queue (glossary "Freigabeliste der Mandanten", tenant
 * supervision spec §6.2): every tenant at `pending` (glossary "Freigabe
 * ausstehend"), for the instance owner to approve or decline. The
 * selection is exactly
 *
 *   tenant `supervisionLevel === "pending"`
 *
 * so a tenant without a stored level (`free` by fallback) is never a row,
 * and the queue does not tell a newly created tenant from one reset to
 * `pending` - `lastChange` does (`tenant.created` is new,
 * `tenant.levelChanged` with `to: "pending"` is reset, with its reason).
 *
 * Unlike the active review queue, the rows come from one collection, so
 * the database sorts (`supervisionChangedAt` ascending, `id` breaking a
 * tie) and cuts the page; `total` is the queue's counter. Each row is then
 * completed from what the decision needs: the owner memberships with their
 * accounts, two counts of the tenant's offers (never the offers) and the
 * newest history row about the tenant. Approving and declining run over
 * `PUT /api/tenants/:tenant/supervision` per tenant; there is no bulk
 * action and no admin path in a row.
 */

const TenantManager = require("../../data-managers/tenant-manager");
const MembershipManager = require("../../data-managers/membership-manager");
const UserManager = require("../../data-managers/user-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");
const EventManager = require("../../data-managers/event-manager");
const SupervisionHistoryManager = require("../../data-managers/supervision-history-manager");
const { SUPERVISION_LEVELS } = require("./supervision-constants");
const { pageWindow } = require("./page-window");
const { DOMAIN } = require("../authorization/reach");

/** Longest waiting first, the id making the order total. */
const QUEUE_ORDER = Object.freeze({ supervisionChangedAt: 1, id: 1 });

/** A user's name as the row shows it; null without one. */
const displayNameOf = (user) =>
  [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;

class TenantApprovalQueueService {
  /**
   * One page of the tenant approval queue, longest waiting first.
   *
   * @param {Object} [params]
   * @param {number|string} [params.page] 1-based
   * @param {number|string} [params.pageSize] Capped at 200
   * @returns {Promise<{items: Object[], total: number, page: number, pageSize: number}>}
   *   A row is `{ tenantId, tenantName, waitingSince, contact, owners,
   *   offerCount, lastChange }`
   */
  static async listTenantApprovalQueue({ page, pageSize } = {}) {
    const window = pageWindow({ page, pageSize });
    const selection = { supervisionLevel: SUPERVISION_LEVELS.PENDING };

    const [tenants, total] = await Promise.all([
      TenantManager.getTenants(
        DOMAIN,
        {
          ...selection,
          sort: QUEUE_ORDER,
          skip: window.skip,
          limit: window.pageSize,
        },
        DOMAIN,
      ),
      TenantManager.countTenants(DOMAIN, selection),
    ]);

    const items = await Promise.all(
      tenants.map((tenant) => TenantApprovalQueueService._row(tenant)),
    );

    return { items, total, page: window.page, pageSize: window.pageSize };
  }

  static async _row(tenant) {
    const [owners, bookableCount, eventCount, lastChange] = await Promise.all([
      TenantApprovalQueueService._owners(tenant.id),
      BookableManager.countBookables(tenant.id),
      EventManager.countEvents(tenant.id),
      SupervisionHistoryManager.latestTenantRow(tenant.id),
    ]);
    return {
      tenantId: tenant.id,
      tenantName: tenant.name ?? null,
      waitingSince: tenant.supervisionChangedAt ?? null,
      contact: {
        contactName: tenant.contactName ?? null,
        mail: tenant.mail ?? null,
        phone: tenant.phone ?? null,
        website: tenant.website ?? null,
        location: tenant.location ?? null,
      },
      owners,
      offerCount: bookableCount + eventCount,
      lastChange: lastChange ?? null,
    };
  }

  /**
   * The owners of a tenant: every membership with `owner: true`, with the
   * name of its account. A user id is the account's mail address; an owner
   * without an account keeps the id and has no name.
   */
  static async _owners(tenantId) {
    const memberships =
      await MembershipManager.getOwnerMembershipsByTenantID(tenantId);
    if (memberships.length === 0) {
      return [];
    }
    const users = await UserManager.getUsersById(
      memberships.map((membership) => membership.userId),
    );
    const byId = new Map(users.map((user) => [user.id, user]));
    return memberships.map((membership) => ({
      userId: membership.userId,
      displayName: displayNameOf(byId.get(membership.userId)),
      mail: membership.userId,
    }));
  }
}

module.exports = TenantApprovalQueueService;
