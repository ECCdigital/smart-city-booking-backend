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

/** The reaches, widest first: the order `decide` tries them in. */
const REACHES = Object.freeze([REACH.ANY, REACH.OWN, REACH.PUBLIC]);

const ROLE_LEVEL = /^([a-zA-Z]+)\.([a-zA-Z]+)$/;

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
 * Whether a principal satisfies a level of the table, with the fixed
 * precedence instanceOwner ⊇ tenantOwner ⊇ role ⊇ signedIn.
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
  switch (level) {
    case "instanceOwner":
      return false;
    case "mayCreateTenant":
      return principal.mayCreateTenant === true;
    case "tenantOwner":
      return principal.isTenantOwner === true;
    case "signedIn":
      return principal.userId != null;
    default: {
      const match = level.match(ROLE_LEVEL);
      if (!match) {
        throw new Error(`authorization: unknown level ${level}`);
      }
      if (principal.isTenantOwner) {
        return true;
      }
      const [, group, step] = match;
      return principal.grants?.[group]?.[step] === true;
    }
  }
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
        const match = level.match(ROLE_LEVEL);
        const known = match
          ? ROLE_GROUPS.includes(match[1]) && ROLE_LEVELS.includes(match[2])
          : [
              "signedIn",
              "tenantOwner",
              "instanceOwner",
              "mayCreateTenant",
            ].includes(level);
        if (!known) {
          throw new Error(`authorization: unknown level ${level} in ${where}`);
        }
      }
    }
  }
}

assertTable();

module.exports = { decide, entryOf, satisfies, REACH, REACHES };
