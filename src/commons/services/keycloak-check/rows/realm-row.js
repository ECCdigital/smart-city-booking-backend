/**
 * Row 1, realm and issuer (step „Realm anlegen“): the realm's discovery
 * document names exactly `<serverUrl>/realms/<realm>` as its issuer, the
 * issuer every token of the realm must carry. The row gates the others:
 * when it is not `ok`, every other row is `na` (`realm_unavailable`).
 */

const { probe } = require("../probe-client");
const { STATUS, finding, notCheckable } = require("../findings");

const ROW_ID = 1;

/**
 * The finding of the discovery probe.
 *
 * @param {Object} context The check context
 * @param {Object} result The probe result
 * @returns {Object} The finding
 */
function realmFinding(context, result) {
  if (result.outcome !== "response") return notCheckable(result);

  if (result.status === 404) {
    return finding(STATUS.FAIL, "realm_not_found", {
      httpStatus: 404,
      url: result.url,
    });
  }

  const issuer = result.data?.issuer;
  if (result.status !== 200 || typeof issuer !== "string") {
    return notCheckable(result);
  }

  return issuer === context.issuer
    ? finding(STATUS.OK, "issuer_matches", { issuer })
    : finding(STATUS.FAIL, "issuer_mismatch", {
        expected: context.issuer,
        actual: issuer,
      });
}

/**
 * Probes the discovery document of the stored realm and answers row 1.
 *
 * @param {Object} context The check context
 * @param {import("../check-results").CheckResults} results The rows so far
 * @returns {Promise<void>}
 */
async function evaluate(context, results) {
  const result = await probe({
    url: `${context.issuer}/.well-known/openid-configuration`,
  });
  results.set(ROW_ID, realmFinding(context, result));
}

module.exports = {
  rowIds: () => [ROW_ID],
  evaluate,
};
