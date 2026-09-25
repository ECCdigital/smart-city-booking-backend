/**
 * The principal (glossary "Prinzipal"): who makes a request, as one value
 * loaded once per request. The one place of the module that reads: it
 * takes the membership picture (glossary "Mitgliedschaftsbild", ADR 0004)
 * of `UserManager.getMembershipPicture` - the instance ownership, the
 * tenant-creation setting and, per active membership, the owner flag, the
 * role levels merged over the role catalogue and the supervision of the
 * tenant. The sign-in answer is a projection of the same picture, never
 * the principal's source.
 *
 * The declined tenant (glossary "Abweisung") is decided here, once: the
 * membership in it rests (glossary "Ruhende Mitgliedschaft") - the
 * principal is no member and no tenant owner there and holds no role
 * level, so every path that decides from it (a marker, a second decision
 * of a handler, a question across tenants) meets the declination without
 * asking for it. What rests is kept as `restingMembership`, for the answer
 * that names the declination.
 *
 * The same load gives the principal its tenant sets (`tenants`, ADR
 * 0002): the tenants the user belongs to, owns, or reads a tenant entry
 * with `any` in. On the instance level that is what "own" means, and a
 * manager never asks for the memberships again.
 */

const UserManager = require("../../data-managers/user-manager");
const { isDeclined } = require("../supervision/supervision-constants");
const { decide, REACH } = require("./policy");
const { ROLE_GROUPS, OWNER_KEY } = require("./table");

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
 * @property {{member: string[], owner: string[], reach: Object<string, string[]>}} tenants
 *   - the tenant sets of the user (ADR 0002), what "own" means on the
 *   instance level (`OWNER_KEY`, `tenantsOf`): `member` the tenants they
 *   belong to - a resting membership is a membership still, it grants
 *   nothing but the tenant stays theirs to see -, `owner` the ones they
 *   own and `reach` the ones they hold `any` in, by the tenant entry
 *   asked (`"dashboard.read"`); the two rights sets leave a resting
 *   membership out
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
    tenants: { member: [], owner: [], reach: {} },
  };
}

/** The tenant entries of `OWNER_KEY` that ask a reach, by their set name. */
const REACH_ENTRIES = Object.values(OWNER_KEY)
  .flatMap((directory) => [
    directory,
    ...Object.values(directory.byAction ?? {}),
  ])
  .filter((key) => key.tenantsOf === "reach")
  .map((key) => key.entry);

/** Whether the membership rests: its tenant is declined. */
const rests = (membership) => isDeclined(membership.supervision);

/**
 * The tenant sets of a user, from the memberships of the picture: see
 * `Principal.tenants`.
 *
 * @param {Object} picture - The membership picture.
 * @param {string} userId
 * @returns {{member: string[], owner: string[], reach: Object<string, string[]>}}
 */
function tenantsIn(picture, userId) {
  const memberships = picture.memberships ?? [];
  const active = memberships.filter((membership) => !rests(membership));
  const reach = {};
  for (const entry of new Set(REACH_ENTRIES)) {
    const [resource, action] = entry.split(".");
    reach[entry] = active
      .filter(
        (membership) =>
          decide(
            principalOf(picture, userId, membership.tenantId),
            resource,
            action,
          ) === REACH.ANY,
      )
      .map((membership) => membership.tenantId);
  }
  return {
    member: memberships.map((membership) => membership.tenantId),
    owner: active
      .filter((membership) => membership.isOwner === true)
      .map((membership) => membership.tenantId),
    reach,
  };
}

/**
 * The principal of a user in a tenant, built from the membership picture.
 * A principal without a tenant has no membership.
 *
 * @param {Object} picture - The answer of `getMembershipPicture`.
 * @param {string} userId
 * @param {string|null} tenantId
 * @returns {Principal}
 */
function principalIn(picture, userId, tenantId) {
  return {
    ...principalOf(picture, userId, tenantId),
    tenants: tenantsIn(picture, userId),
  };
}

/**
 * The principal in one tenant, without its tenant sets: what a decision
 * in that tenant needs (`decide`), and what the sets are computed from.
 *
 * @param {Object} picture - The membership picture.
 * @param {string} userId
 * @param {string|null} tenantId
 * @returns {Omit<Principal, "tenants">}
 */
function principalOf(picture, userId, tenantId) {
  const membership = tenantId
    ? (picture.memberships ?? []).find((entry) => entry.tenantId === tenantId)
    : null;
  const resting = Boolean(membership) && rests(membership);
  const active = resting ? null : membership;

  const grants = {};
  for (const group of ROLE_GROUPS) {
    grants[group] = { ...(active?.grants?.[group] || {}) };
  }

  return {
    userId,
    tenantId,
    isInstanceOwner: picture.instanceOwner === true,
    isMember: Boolean(active),
    isTenantOwner: active?.isOwner === true,
    grants,
    mayCreateTenant: picture.mayCreateTenant === true,
    restingMembership: resting ? { ...membership.supervision } : null,
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
  const picture = await UserManager.getMembershipPicture(userId);
  return principalIn(picture, userId, tenant);
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
  let picture;
  return async (tenantId) => {
    if (!userId) {
      return false;
    }
    picture ??= UserManager.getMembershipPicture(userId);
    const principal = principalOf(await picture, userId, tenantId);
    return decide(principal, resource, action) === REACH.ANY;
  };
}

/**
 * The tenant set an owner key names, from the principal (ADR 0002): what
 * `scopeOf` puts on the scope as `tenantIds` under `own`.
 *
 * @param {Object} principal
 * @param {{tenantsOf: string, entry?: string}} key - An owner key of
 *   `OWNER_KEY` with a tenant set.
 * @returns {string[]}
 */
function tenantsOf(principal, key) {
  const sets = principal?.tenants ?? { member: [], owner: [], reach: {} };
  switch (key.tenantsOf) {
    case "membership":
      return sets.member;
    case "ownership":
      return sets.owner;
    case "reach":
      return sets.reach[key.entry] ?? [];
    default:
      throw new Error(`authorization: unknown tenant set ${key.tenantsOf}`);
  }
}

module.exports = {
  loadPrincipal,
  anyReachIn,
  tenantsOf,
  anonymous,
};
