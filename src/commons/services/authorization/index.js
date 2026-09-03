/**
 * Authorization: one pure policy over a rights table, a principal loaded
 * once per request, and the three route markers. See the authorize spec
 * (`.scratch/architecture/authorize/spec.md`) and the glossary section
 * "Rechte" in `CONTEXT.md`.
 */

const { loadPrincipal } = require("./principal");
const { decide, REACH } = require("./policy");
const { TABLE, ROLE_GROUPS, ROLE_LEVELS } = require("./table");
const {
  authorize,
  publicRoute,
  tokenAuthorized,
  MARKER,
} = require("./middleware");

module.exports = {
  loadPrincipal,
  decide,
  REACH,
  TABLE,
  ROLE_GROUPS,
  ROLE_LEVELS,
  authorize,
  public: publicRoute,
  publicRoute,
  tokenAuthorized,
  MARKER,
};
