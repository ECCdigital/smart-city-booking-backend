/**
 * Row 9, client roles (step „Client-Rollen zuordnen“): the web client's
 * roles of the instance owner, as they arrive in the token of the owner's
 * SSO sign-in (`resource_access`), for the role mapping to map. Information
 * only: from outside nobody can tell whether the owner holds no role or a
 * mapper is missing.
 */

const { STATUS, finding } = require("../findings");
const { webClientTokenOf } = require("./web-client-token");

const ROW_ID = 9;

/**
 * Row 9 is there only while the stored role mapping is active.
 *
 * @param {Object} context The check context
 * @returns {number[]} `[9]` or `[]`
 */
function rowIds(context) {
  return context.roleMappingActive ? [ROW_ID] : [];
}

/**
 * Reads the client roles of the request's token and answers row 9, while
 * the role mapping is active.
 *
 * @param {Object} context The check context
 * @param {import("../check-results").CheckResults} results The rows so far
 * @returns {Promise<void>}
 */
async function evaluate(context, results) {
  if (!context.roleMappingActive) return;

  const token = webClientTokenOf(context);
  if (token.unreadable) {
    results.set(ROW_ID, token.unreadable);
    return;
  }

  const roles =
    token.claims.resource_access?.[context.publicClient]?.roles ?? [];
  results.set(ROW_ID, finding(STATUS.INFO, "client_roles", { roles }));
}

module.exports = {
  rowIds,
  evaluate,
};
