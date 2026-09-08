/**
 * Authorization: one pure policy over a rights table, a principal loaded
 * once per request, and the three route markers. See the authorize spec
 * (`.scratch/architecture/authorize/spec.md`) and the glossary section
 * "Rechte" in `CONTEXT.md`.
 */

const { loadPrincipal } = require("./principal");
const { decide, REACH } = require("./policy");
const { ownCondition, withinReach, readsRecords } = require("./reach");
const { TABLE, ROLE_GROUPS, ROLE_LEVELS } = require("./table");
const {
  authorize,
  publicRoute,
  tokenAuthorized,
  scopeOf,
  scopeFor,
  MARKER,
} = require("./middleware");

module.exports = {
  loadPrincipal,
  decide,
  REACH,
  ownCondition,
  withinReach,
  readsRecords,
  TABLE,
  ROLE_GROUPS,
  ROLE_LEVELS,
  authorize,
  public: publicRoute,
  publicRoute,
  tokenAuthorized,
  scopeOf,
  scopeFor,
  MARKER,
};
