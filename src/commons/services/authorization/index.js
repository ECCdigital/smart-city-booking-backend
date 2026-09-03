/**
 * Authorization: one pure policy over a rights table, a principal loaded
 * once per request, and the three route markers. See the authorize spec
 * (`.scratch/architecture/authorize/spec.md`) and the glossary section
 * "Rechte" in `CONTEXT.md`.
 */

const { loadPrincipal, anonymous } = require("./principal");
const { decide, entryOf, REACH, REACHES } = require("./policy");
const { TABLE, ROLE_GROUPS, ROLE_LEVELS } = require("./table");
const middleware = require("./middleware");

module.exports = {
  loadPrincipal,
  anonymous,
  decide,
  entryOf,
  REACH,
  REACHES,
  TABLE,
  ROLE_GROUPS,
  ROLE_LEVELS,
  ...middleware,
};
