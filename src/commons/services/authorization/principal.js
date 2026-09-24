/**
 * The principal (glossary "Prinzipal"): who makes a request, as one value
 * loaded once per request. The one place of the module that reads: it
 * reuses `UserManager.getUserPermissions`, which already feeds the signin
 * answer with the merged role levels of every active membership, the
 * instance ownership, the tenant-creation setting and the supervision of
 * every tenant of the user.
 *
 * The declined tenant (glossary "Abweisung") is decided here, once: the
 * membership in it rests (glossary "Ruhende Mitgliedschaft") - the
 * principal is no member and no tenant owner there and holds no role
 * level, so every path that decides from it (a marker, a second decision
 * of a handler, a question across tenants) meets the declination without
 * asking for it. What rests is kept as `restingMembership`, for the answer
 * that names the declination.
 */

const UserManager = require("../../data-managers/user-manager");
const {
  isDeclined,
  supervisionOf,
} = require("../supervision/supervision-constants");
const { decide, REACH } = require("./policy");
const { ROLE_GROUPS } = require("./table");

/**
 * @typedef {Object} Principal
 * @property {string|null} userId - null = anonymous
 * @property {string|null} tenantId - null = instance level
 * @property {boolean} isInstanceOwner
 * @property {boolean} isMember - an active membership in the tenant that
 *   does not rest (glossary "Mitglied")
 * @property {boolean} isTenantOwner - `membership.owner` in the tenant
 * @property {Object<string, Object<string, boolean>>} grants - the merged
 *   role levels in the tenant, by group (`manageBookings.readAny`, ...);
 *   empty without a tenant
 * @property {boolean} mayCreateTenant
 * @property {{supervisionLevel: string, supervisionChangedAt: Date|null, supervisionReason: string|null}|null} restingMembership
 *   - the supervision of the declined tenant the membership rests in, or
 *   null
 */

/**
 * The anonymous principal: no flags, no grants.
 *
 * @param {string|null} tenantId
 * @returns {Principal}
 */
function anonymous(tenantId = null) {
  return {
    userId: null,
    tenantId,
    isInstanceOwner: false,
    isMember: false,
    isTenantOwner: false,
    grants: {},
    mayCreateTenant: false,
    restingMembership: null,
  };
}

/**
 * The principal of a user in a tenant, built from the answer of
 * `getUserPermissions`. A principal without a tenant has no membership.
 *
 * @param {Object} permissions - The answer of `getUserPermissions`.
 * @param {string} userId
 * @param {string|null} tenantId
 * @returns {Principal}
 */
function principalIn(permissions, userId, tenantId) {
  const membership = tenantId
    ? permissions.tenants.find((entry) => entry.tenantId === tenantId)
    : null;
  const rests = Boolean(membership) && isDeclined(membership);
  const active = rests ? null : membership;

  const grants = {};
  for (const group of ROLE_GROUPS) {
    grants[group] = { ...(active?.[group] || {}) };
  }

  return {
    userId,
    tenantId,
    isInstanceOwner: permissions.instanceOwner === true,
    isMember: Boolean(active),
    isTenantOwner: active?.isOwner === true,
    grants,
    mayCreateTenant: permissions.allowCreateTenant === true,
    restingMembership: rests ? supervisionOf(membership) : null,
  };
}

/**
 * Loads the principal of a user in a tenant.
 *
 * @param {string|null|undefined} userId
 * @param {string|null|undefined} tenantId
 * @returns {Promise<Principal>}
 */
async function loadPrincipal(userId, tenantId) {
  const tenant = tenantId ?? null;
  if (!userId) {
    return anonymous(tenant);
  }
  const permissions = await UserManager.getUserPermissions(userId);
  return principalIn(permissions, userId, tenant);
}

/**
 * The question of a route asked across tenants, for a request whose own
 * tenant is none (the instance dashboard, the access bookings of a person,
 * the tenant list): in which tenant does the user have the reach `any` for
 * the action on the resource? Loads on the first question and answers
 * every further one from the same load - every tenant for the instance
 * owner, none where the membership rests.
 *
 * @param {string|null|undefined} userId
 * @param {string} resource
 * @param {string} action
 * @returns {(tenantId: string) => Promise<boolean>}
 */
function anyReachIn(userId, resource, action) {
  let permissions;
  return async (tenantId) => {
    if (!userId) {
      return false;
    }
    permissions ??= UserManager.getUserPermissions(userId);
    const principal = principalIn(await permissions, userId, tenantId);
    return decide(principal, resource, action) === REACH.ANY;
  };
}

module.exports = { loadPrincipal, anyReachIn, anonymous };
