/**
 * Row 7, the API client may introspect (step „API-Client anlegen“): the
 * stored API client (`privateClient`) authenticates with its stored secret
 * at the introspection endpoint, the way the backend checks every SSO
 * token. A dummy token answers `200 {"active": false}` then; no flow needs
 * to be enabled on the API client for that.
 */

const { probe } = require("../probe-client");
const { STATUS, finding, notCheckable } = require("../findings");

const ROW_ID = 7;

/**
 * The cause of a refused API client by the JSON `error` of the client
 * credentials grant that follows (observed on Keycloak 26.7.3 and 26.8.0).
 */
const REFUSAL_REASONS = Object.freeze({
  unauthorized_client: "api_client_secret_wrong",
  invalid_client: "api_client_unknown_or_disabled",
});

/**
 * The `Authorization` header of the API client: HTTP Basic with the stored
 * secret, encoded as the token check sends it.
 *
 * @param {Object} context The check context
 * @returns {Object<string, string>} The header
 */
function apiClientAuthorization(context) {
  const credentials = `${context.privateClient}:${context.privateClientSecret}`;
  return {
    Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
  };
}

/**
 * The finding of the introspection of a dummy token.
 *
 * @param {Object} result The probe result
 * @returns {Object} The finding
 */
function introspectionFinding(result) {
  if (result.outcome !== "response") return notCheckable(result);

  if (result.status === 200 && result.data?.active === false) {
    return finding(STATUS.OK, "introspection_allowed");
  }
  if (result.status === 403) {
    return finding(STATUS.FAIL, "api_client_public", { httpStatus: 403 });
  }
  return notCheckable(result);
}

/**
 * The finding of the follow-up probe after the introspection refused the
 * API client (`401`): the token endpoint names the cause in its JSON
 * `error`. Any other result leaves every cause open, the refusal stands.
 *
 * @param {Object} result The probe result of the client credentials grant
 * @returns {Object} The finding
 */
function refusalFinding(result) {
  const reason =
    result.outcome === "response" && result.status === 401
      ? REFUSAL_REASONS[result.data?.error]
      : undefined;
  return reason
    ? finding(STATUS.FAIL, reason)
    : finding(STATUS.FAIL, "introspection_unauthorized", { httpStatus: 401 });
}

/**
 * Introspects a dummy token as the API client and answers row 7. Only when
 * the introspection refuses the API client (`401`, the same for a wrong
 * secret and an unknown or disabled client) does a client credentials grant
 * with the same credentials tell the causes apart; authentication has
 * failed already, so it can never issue a token.
 *
 * @param {Object} context The check context
 * @param {import("../check-results").CheckResults} results The rows so far
 * @returns {Promise<void>}
 */
async function evaluate(context, results) {
  const authorization = apiClientAuthorization(context);
  const result = await probe({
    method: "POST",
    url: `${context.oidcBase}/token/introspect`,
    form: { token: "x" },
    headers: authorization,
  });
  if (result.outcome !== "response" || result.status !== 401) {
    results.set(ROW_ID, introspectionFinding(result));
    return;
  }

  const followUp = await probe({
    method: "POST",
    url: `${context.oidcBase}/token`,
    form: { grant_type: "client_credentials" },
    headers: authorization,
  });
  results.set(ROW_ID, refusalFinding(followUp));
}

module.exports = {
  rowIds: () => [ROW_ID],
  evaluate,
  apiClientAuthorization,
};
