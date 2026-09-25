/**
 * The reach (glossary "Reichweite") as a query condition, ADR 0002: a
 * manager names the resource it reads and gets back what to add to its
 * query. The owner key of the resource (glossary "Eigentümer-Schlüssel")
 * is the table's (`OWNER_KEY` in `table.js`), so the manager and the
 * table cannot disagree about what "own" means.
 *
 *   any        nothing - every record of the tenant
 *   domain     nothing - the domain itself reads, without a principal
 *   own        `{ [key]: userId }` - the principal's own records; on the
 *              instance level `{ id: { $in: tenantIds } }` - the tenant
 *              set the scope carries (`scopeOf` in `middleware.js`)
 *
 * A manager reads only with a reach: a missing one is a programming
 * error and throws here, at the one place every condition passes
 * through, instead of reading everything. Nor is `public` a condition on
 * records - what the public sees is the public projection of the offers
 * (ADR 0003, `services/supervision/public-projection.js`), which the
 * managers of the offers apply to what they read; a manager of anything
 * else that is read under `public` answers what its handler projects and
 * says so in place - nor `self`: the principal themselves is no record
 * (ADR 0001). Asking for a condition under either is a programming error
 * too, as is `own` without a user or without the tenant set: the
 * condition would match records nobody owns.
 *
 * `DOMAIN` is the reach the domain reads under: a frozen scope every
 * caller inside `src/commons` names in place of the absence it left
 * before. No router assigns it - `scopeOf` and `reachesOf` never answer
 * it - and it does not occur under `src/platform`
 * (`tests/authorization-invariants.test.js`). `PUBLIC` is the public's
 * view, whoever asks: a handler may ask narrower than its right, never
 * wider (ADR 0003) - the anonymized booking list, the public calendar
 * without `includePrivate` read as the public, whatever the route's reach.
 *
 * `withinReach` is the same question about a record already in hand, for
 * an adapter that loaded it before it knew which reach applies (a medium
 * that turns out to be a booking document, a referenced medium that has
 * to be told apart from an unknown one). Those adapters are a named list
 * too (ticket 04 shortens it). It answers yes to `any` and `domain` and
 * to an owned record - where the domain reads everything, an adapter
 * holds a reach.
 *
 * `readsRecords` is the question the two of them leave open: whether a
 * reach reaches records at all, or only what the public sees.
 */

const { REACH } = require("./policy");
const { OWNER_KEY } = require("./table");

/** The reach the domain reads under. */
const DOMAIN = Object.freeze({ reach: REACH.DOMAIN, userId: null });

/** The public's view: what anyone may see, whoever asks - never wider than the route's right. */
const PUBLIC = Object.freeze({ reach: REACH.PUBLIC, userId: null });

/**
 * The owner key a manager applies for a resource: the key every `own`
 * entry of the resource shares. An entry that owns something else
 * (`byAction`) is the concern of the manager of *that* thing.
 *
 * @param {string} resource
 * @returns {{key: string}|{tenantsOf: string}}
 * @throws {Error} for a resource without a shared owner key
 */
function ownerKeyOfResource(resource) {
  const shared = Object.fromEntries(
    Object.entries(OWNER_KEY[resource] ?? {}).filter(
      ([name]) => name !== "byAction",
    ),
  );
  if (!Object.keys(shared).length) {
    throw new Error(`authorization: no owner key for resource ${resource}`);
  }
  return shared;
}

/**
 * @param {string} resource - The resource the manager reads.
 * @param {{reach?: string, userId?: string|null, tenantIds?: string[]}} [scope]
 * @returns {Object} The condition to spread into the query.
 * @throws {Error} without a reach, or under a reach that is no condition
 */
function ownCondition(resource, { reach, userId, tenantIds } = {}) {
  if (reach === undefined) {
    throw new Error(`authorization: ${resource} read without a reach`);
  }
  if (reach === REACH.ANY || reach === REACH.DOMAIN) {
    return {};
  }
  if (reach === REACH.OWN) {
    const owner = ownerKeyOfResource(resource);
    if (owner.tenantsOf) {
      if (!Array.isArray(tenantIds)) {
        throw new Error(
          `authorization: reach own on ${resource} without the tenant set`,
        );
      }
      return { id: { $in: tenantIds } };
    }
    if (!userId) {
      throw new Error("authorization: reach own without a user");
    }
    return { [owner.key]: userId };
  }
  throw new Error(`authorization: no record condition under reach ${reach}`);
}

/**
 * Whether a record the caller already holds lies within a reach.
 *
 * @param {Object} record - The record.
 * @param {string} key - The field that names the owner of the entity.
 * @param {{reach?: string, userId?: string|null}} [scope]
 * @returns {boolean}
 */
function withinReach(record, key, { reach, userId } = {}) {
  if (reach === REACH.ANY || reach === REACH.DOMAIN) {
    return true;
  }
  if (reach === REACH.OWN) {
    return Boolean(userId) && record?.[key] === userId;
  }
  return false;
}

/**
 * Whether a reach reaches records at all: `any`, `own` and `domain` do,
 * `self`, `public` and no reach do not.
 *
 * @param {{reach?: string}} [scope]
 * @returns {boolean}
 */
function readsRecords({ reach } = {}) {
  return reach === REACH.ANY || reach === REACH.OWN || reach === REACH.DOMAIN;
}

module.exports = {
  DOMAIN,
  PUBLIC,
  ownCondition,
  withinReach,
  readsRecords,
};
