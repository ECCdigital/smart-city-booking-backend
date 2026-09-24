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

const { TABLE, ROLE_GROUPS, ROLE_LEVELS } = require("./table");

const REACH = Object.freeze({ ANY: "any", OWN: "own", PUBLIC: "public" });

/**
 * The precedence a rule was satisfied through (glossary "Rechte"):
 * instanceOwner ⊇ tenantOwner ⊇ role ⊇ signedIn, plus `mayCreateTenant`,
 * which follows the instance setting alone and stands outside the chain.
 * The management gate of a declined tenant (tenant supervision spec §6.1)
 * reads it: what a principal has as a tenant owner or role holder is
 * lost there, what any signed-in user has is not.
 */
const PRECEDENCE = Object.freeze({
  INSTANCE_OWNER: "instanceOwner",
  TENANT_OWNER: "tenantOwner",
  ROLE: "role",
  SIGNED_IN: "signedIn",
  MAY_CREATE_TENANT: "mayCreateTenant",
});

/** The reaches, widest first: the order `decide` tries them in. */
const REACHES = Object.freeze([REACH.ANY, REACH.OWN, REACH.PUBLIC]);

/** The levels that are not a role level. */
const LEVEL_KEYWORDS = Object.freeze([
  "signedIn",
  "tenantOwner",
  "instanceOwner",
  "mayCreateTenant",
]);

const ROLE_LEVEL = /^([a-zA-Z]+)\.([a-zA-Z]+)$/;

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

/**
 * Through which precedence a principal satisfies a level of the table -
 * the first of the fixed chain instanceOwner ⊇ tenantOwner ⊇ role ⊇
 * signedIn that does - or `null`.
 *
 * @param {Object} principal
 * @param {string|undefined} level
 * @returns {string|null} One of `PRECEDENCE`, or null
 */
function satisfiedBy(principal, level) {
  if (!level) {
    return null;
  }
  if (principal.isInstanceOwner) {
    return PRECEDENCE.INSTANCE_OWNER;
  }
  const parsed = parseLevel(level);
  if (parsed.kind === "role") {
    if (principal.isTenantOwner === true) {
      return PRECEDENCE.TENANT_OWNER;
    }
    return principal.grants?.[parsed.group]?.[parsed.step] === true
      ? PRECEDENCE.ROLE
      : null;
  }
  switch (parsed.level) {
    case "instanceOwner":
      return null;
    case "mayCreateTenant":
      return principal.mayCreateTenant === true
        ? PRECEDENCE.MAY_CREATE_TENANT
        : null;
    case "tenantOwner":
      return principal.isTenantOwner === true ? PRECEDENCE.TENANT_OWNER : null;
    default:
      return principal.userId != null ? PRECEDENCE.SIGNED_IN : null;
  }
}

/**
 * Whether a principal satisfies a level of the table.
 *
 * @param {Object} principal
 * @param {string|undefined} level
 * @returns {boolean}
 */
function satisfies(principal, level) {
  return satisfiedBy(principal, level) !== null;
}

/**
 * The widest reach the principal has for `(resource, action)` and the
 * precedence it has it through, or `null` without a reach. A public entry
 * reached as such carries no precedence.
 *
 * @param {Object} principal - See `principal.js`.
 * @param {string} resource
 * @param {string} action
 * @returns {{reach: "any"|"own"|"public", satisfiedBy: string|null}|null}
 */
function decideWith(principal, resource, action) {
  const entry = entryOf(resource, action);
  for (const reach of REACHES) {
    if (reach === REACH.PUBLIC) {
      if (entry.public === true) {
        return { reach, satisfiedBy: null };
      }
    } else {
      const precedence = satisfiedBy(principal, entry[reach]);
      if (precedence) {
        return { reach, satisfiedBy: precedence };
      }
    }
  }
  return null;
}

/**
 * The widest reach the principal has for `(resource, action)`, or `null`.
 *
 * @param {Object} principal - See `principal.js`.
 * @param {string} resource
 * @param {string} action
 * @returns {"any"|"own"|"public"|null}
 */
function decide(principal, resource, action) {
  return decideWith(principal, resource, action)?.reach ?? null;
}

/**
 * Checks every entry of the table once, when the module loads: known
 * slots, known levels. A malformed table is a programming error.
 */
function assertTable() {
  for (const [resource, actions] of Object.entries(TABLE)) {
    for (const [action, entry] of Object.entries(actions)) {
      const where = `${resource}.${action}`;
      for (const key of Object.keys(entry)) {
        if (!["public", "own", "any"].includes(key)) {
          throw new Error(`authorization: unknown slot ${key} in ${where}`);
        }
      }
      for (const level of [entry.own, entry.any].filter(Boolean)) {
        try {
          parseLevel(level);
        } catch (err) {
          throw new Error(`${err.message} in ${where}`);
        }
      }
    }
  }
}

assertTable();

module.exports = {
  decide,
  decideWith,
  entryOf,
  satisfies,
  parseLevel,
  REACH,
  REACHES,
  PRECEDENCE,
  LEVEL_KEYWORDS,
};
