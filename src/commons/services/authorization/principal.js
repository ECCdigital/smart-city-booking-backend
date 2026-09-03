/**
 * The principal (glossary "Prinzipal"): who makes a request, as one value
 * loaded once per request. The one place of the module that reads: it
 * reuses `UserManager.getUserPermissions`, which already feeds the signin
 * answer with the merged role levels of every active membership, the
 * instance ownership and the tenant-creation setting.
 */

const UserManager = require("../../data-managers/user-manager");
const { ROLE_GROUPS } = require("./table");

/**
 * @typedef {Object} Principal
 * @property {string|null} userId - null = anonymous
 * @property {string|null} tenantId - null = instance level
 * @property {boolean} isInstanceOwner
 * @property {boolean} isTenantOwner - `membership.owner` in the tenant
 * @property {Object<string, Object<string, boolean>>} grants - the merged
 *   role levels in the tenant, by group (`manageBookings.readAny`, ...);
 *   empty without a tenant
 * @property {boolean} mayCreateTenant
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
    isTenantOwner: false,
    grants: {},
    mayCreateTenant: false,
  };
}

/**
 * Loads the principal of a user in a tenant. A principal without a tenant
 * has no grants and is never a tenant owner.
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
  const membership = tenant
    ? permissions.tenants.find((entry) => entry.tenantId === tenant)
    : null;

  const grants = {};
  for (const group of ROLE_GROUPS) {
    grants[group] = { ...(membership?.[group] || {}) };
  }

  return {
    userId,
    tenantId: tenant,
    isInstanceOwner: permissions.instanceOwner === true,
    isTenantOwner: membership?.isOwner === true,
    grants,
    mayCreateTenant: permissions.allowCreateTenant === true,
  };
}

module.exports = { loadPrincipal, anonymous };
