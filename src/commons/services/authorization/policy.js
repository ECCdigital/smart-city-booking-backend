/**
 * The policy: `decide(principal, resource, action)` answers the widest
 * reach (glossary "Reichweite") the principal has for the action on the
 * resource, or `null`. Pure and synchronous - the principal is a value
 * loaded once per request (`principal.js`), the table is data
 * (`table.js`); nothing here reads anything.
 *
 * An unknown `(resource, action)` is a programming error and throws; the
 * middleware asks `entryOf` when the router loads, so a typo in a route
 * fails the start, not a request.
 */

const {
  TABLE,
  OWNER_KEY,
  ownerKeyOf,
  ROLE_GROUPS,
  ROLE_LEVELS,
} = require("./table");

const REACH = Object.freeze({
  ANY: "any",
  OWN: "own",
  SELF: "self",
  PUBLIC: "public",
  DOMAIN: "domain",
});

/**
 * The reaches a principal can have, widest first: the order `decide`
 * tries them in. `domain` is none of them - the domain reads under it
 * without a principal (ADR 0002, `DOMAIN` in `reach.js`), no route ever
 * decides it.
 */
const REACHES = Object.freeze([REACH.ANY, REACH.OWN, REACH.SELF, REACH.PUBLIC]);

/** The slots of an entry: the reaches, each named by its least level. */
const SLOTS = Object.freeze(["public", "own", "self", "any"]);

/** The levels that are not a role level. */
const LEVEL_KEYWORDS = Object.freeze([
  "signedIn",
  "tenantMember",
  "tenantOwner",
  "instanceOwner",
  "mayCreateTenant",
]);

const ROLE_LEVEL = /^([a-zA-Z]+)\.([a-zA-Z]+)$/;

/** The tenant sets of the principal an owner key may name (`table.js`). */
const TENANT_SETS = Object.freeze(["membership", "ownership", "reach"]);

/**
 * A level of the table, read: a keyword, or a role level with its group
 * and step. Unknown levels are a programming error.
 *
 * @param {string} level
 * @returns {{kind: "keyword", level: string}|{kind: "role", group: string, step: string}}
 */
function parseLevel(level) {
  if (LEVEL_KEYWORDS.includes(level)) {
    return { kind: "keyword", level };
  }
  const match = level.match(ROLE_LEVEL);
  if (
    match &&
    ROLE_GROUPS.includes(match[1]) &&
    ROLE_LEVELS.includes(match[2])
  ) {
    return { kind: "role", group: match[1], step: match[2] };
  }
  throw new Error(`authorization: unknown level ${level}`);
}

/**
 * The entry of the table for an action on a resource.
 *
 * @param {string} resource
 * @param {string} action
 * @returns {{public?: boolean, own?: string, any?: string}}
 * @throws {Error} when the table has no such entry
 */
function entryOf(resource, action) {
  const entry = TABLE[resource]?.[action];
  if (!entry) {
    throw new Error(
      `authorization: no entry ${resource}.${action} in the rights table`,
    );
  }
  return entry;
}

/** Whether the principal holds any role level in the tenant. */
const holdsARole = (principal) =>
  Object.values(principal.grants ?? {}).some((group) =>
    Object.values(group ?? {}).some(Boolean),
  );

/**
 * Whether a principal satisfies a level of the table, with the fixed
 * precedence instanceOwner ⊇ tenantOwner ⊇ role ⊇ tenantMember ⊇
 * signedIn. A resting membership (glossary "Ruhende Mitgliedschaft") is
 * already in the principal: it is no member, no tenant owner and holds no
 * role level there.
 *
 * @param {Object} principal
 * @param {string|undefined} level
 * @returns {boolean}
 */
function satisfies(principal, level) {
  if (!level) {
    return false;
  }
  if (principal.isInstanceOwner) {
    return true;
  }
  const parsed = parseLevel(level);
  if (parsed.kind === "role") {
    return (
      principal.isTenantOwner === true ||
      principal.grants?.[parsed.group]?.[parsed.step] === true
    );
  }
  switch (parsed.level) {
    case "instanceOwner":
      return false;
    case "mayCreateTenant":
      return principal.mayCreateTenant === true;
    case "tenantOwner":
      return principal.isTenantOwner === true;
    case "tenantMember":
      return (
        principal.isMember === true ||
        principal.isTenantOwner === true ||
        holdsARole(principal)
      );
    default:
      return principal.userId != null;
  }
}

/**
 * The widest reach the principal has for `(resource, action)`, or `null`.
 *
 * @param {Object} principal - See `principal.js`.
 * @param {string} resource
 * @param {string} action
 * @returns {"any"|"own"|"self"|"public"|null} Never `domain`.
 */
function decide(principal, resource, action) {
  const entry = entryOf(resource, action);
  for (const reach of REACHES) {
    if (reach === REACH.PUBLIC) {
      if (entry.public === true) {
        return reach;
      }
    } else if (satisfies(principal, entry[reach])) {
      return reach;
    }
  }
  return null;
}

/**
 * An owner key, read: a field, or a tenant set of the principal - and
 * for the set "reach" the tenant entry it is asked with, which has to be
 * an entry of the table.
 *
 * @param {string} where
 * @param {{key?: string, tenantsOf?: string, entry?: string}} key
 */
function assertOwnerKey(where, key) {
  if (key.key) {
    return;
  }
  if (!TENANT_SETS.includes(key.tenantsOf)) {
    throw new Error(`authorization: unknown owner key at ${where}`);
  }
  if (key.tenantsOf === "reach") {
    const [resource, action] = String(key.entry ?? "").split(".");
    if (!TABLE[resource]?.[action]) {
      throw new Error(
        `authorization: the tenant set "reach" at ${where} names no entry`,
      );
    }
  }
}

/**
 * Checks every entry of the table once, when the module loads: known
 * slots, known levels, an owner key for every `own` and none for an entry
 * without one, `self` and `own` never together. A malformed table is a
 * programming error.
 */
function assertTable() {
  for (const [resource, actions] of Object.entries(TABLE)) {
    for (const [action, entry] of Object.entries(actions)) {
      const where = `${resource}.${action}`;
      for (const key of Object.keys(entry)) {
        if (!SLOTS.includes(key)) {
          throw new Error(`authorization: unknown slot ${key} in ${where}`);
        }
      }
      for (const level of [entry.own, entry.self, entry.any].filter(Boolean)) {
        try {
          parseLevel(level);
        } catch (err) {
          throw new Error(`${err.message} in ${where}`);
        }
      }
      if (entry.own && entry.self) {
        throw new Error(`authorization: ${where} names own and self`);
      }
      if (entry.own) {
        ownerKeyOf(resource, action);
      }
    }
  }
  for (const [resource, directory] of Object.entries(OWNER_KEY)) {
    if (!TABLE[resource]) {
      throw new Error(
        `authorization: owner key of unknown resource ${resource}`,
      );
    }
    const { byAction, ...shared } = directory;
    for (const [where, key] of [
      [resource, shared],
      ...Object.entries(byAction ?? {}).map(([action, key]) => [
        `${resource}.${action}`,
        key,
      ]),
    ]) {
      if (Object.keys(key).length) {
        assertOwnerKey(where, key);
      }
    }
    for (const action of Object.keys(byAction ?? {})) {
      if (!TABLE[resource][action]?.own) {
        throw new Error(
          `authorization: owner key for ${resource}.${action} without own`,
        );
      }
    }
  }
}

assertTable();

module.exports = {
  decide,
  entryOf,
  satisfies,
  parseLevel,
  REACH,
  REACHES,
  LEVEL_KEYWORDS,
  TENANT_SETS,
};
