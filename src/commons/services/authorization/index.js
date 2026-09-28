/**
 * Authorization: one pure policy over a rights table, a principal loaded
 * once per request, and the three route markers. See the glossary section
 * "Rechte" in `CONTEXT.md`, the ADRs under `docs/adr/` and the request
 * flow in `docs/agents/api.md`.
 */

const { loadPrincipal, anyReachIn, tenantsOf } = require("./principal");
const { decide, REACH } = require("./policy");
const {
  DOMAIN,
  PUBLIC,
  ownCondition,
  withinReach,
  readsRecords,
} = require("./reach");
const {
  TABLE,
  OWNER_KEY,
  ownerKeyOf,
  ROLE_GROUPS,
  ROLE_LEVELS,
} = require("./table");
const {
  authorize,
  publicRoute,
  tokenAuthorized,
  scopeOf,
  reachesOf,
  MARKER,
} = require("./middleware");

module.exports = {
  loadPrincipal,
  anyReachIn,
  tenantsOf,
  decide,
  REACH,
  DOMAIN,
  PUBLIC,
  ownCondition,
  withinReach,
  readsRecords,
  TABLE,
  OWNER_KEY,
  ownerKeyOf,
  ROLE_GROUPS,
  ROLE_LEVELS,
  authorize,
  public: publicRoute,
  publicRoute,
  tokenAuthorized,
  scopeOf,
  reachesOf,
  MARKER,
};
