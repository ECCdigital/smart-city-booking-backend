/**
 * Row 8, audience (step „Audience-Mapper anlegen“): the web client's tokens
 * carry the API client in `aud`, so the API client may introspect them
 * (Keycloak 26.6.2 and later answer `active: false` otherwise, and every SSO
 * sign-in fails). Read from the access token of the instance owner's SSO
 * sign-in and confirmed by introspecting it as the API client.
 */

const { probe } = require("../probe-client");
const { STATUS, finding, notCheckable } = require("../findings");
const { apiClientAuthorization } = require("./api-client-row");
const { webClientTokenOf } = require("./web-client-token");

const ROW_ID = 8;
/** Row 7, the API client may introspect: read before this row. */
const API_CLIENT_ROW_ID = 7;

/**
 * The finding of the introspection of the request's token as the API
 * client, for a token that names the API client in `aud`.
 *
 * @param {Object} result The probe result
 * @param {string[]} aud The token's audience
 * @returns {Object} The finding
 */
function introspectionFinding(result, aud) {
  if (result.outcome !== "response" || result.status !== 200) {
    return notCheckable(result);
  }
  if (result.data?.active === true) {
    return finding(STATUS.OK, "audience_present", { aud });
  }
  if (result.data?.active === false) {
    return finding(STATUS.NA, "token_inactive", { aud });
  }
  return notCheckable(result);
}

/**
 * Reads the audience of the request's token and answers row 8.
 *
 * @param {Object} context The check context
 * @param {import("../check-results").CheckResults} results The rows so far
 * @returns {Promise<void>}
 */
async function evaluate(context, results) {
  // An API client that fails row 7 cannot introspect, and Keycloak 26.8.0
  // drops a disabled one from `aud`: a missing mapper would be a guess.
  if (results.get(API_CLIENT_ROW_ID)?.status !== STATUS.OK) {
    results.set(ROW_ID, finding(STATUS.NA, "api_client_invalid"));
    return;
  }

  const token = webClientTokenOf(context);
  if (token.unreadable) {
    results.set(ROW_ID, token.unreadable);
    return;
  }

  // Keycloak sends one audience as a plain string and none as no claim at
  // all (observed): an array either way, in the details too.
  const aud = [].concat(token.claims.aud ?? []);
  if (!aud.includes(context.privateClient)) {
    results.set(ROW_ID, finding(STATUS.FAIL, "audience_missing", { aud }));
    return;
  }

  const result = await probe({
    method: "POST",
    url: `${context.oidcBase}/token/introspect`,
    form: { token: context.accessToken, token_type_hint: "access_token" },
    headers: apiClientAuthorization(context),
  });
  results.set(ROW_ID, introspectionFinding(result, aud));
}

module.exports = {
  rowIds: () => [ROW_ID],
  evaluate,
};
