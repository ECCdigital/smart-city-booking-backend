/**
 * Row 2, `authorize` part, and row 3, PKCE S256 enforced (step „Web-Client
 * anlegen“, ECCdigital/tickets#99): the Authorize-Probe
 * (`authorize-probe.js`) with the first redirect URI row 4 accepted.
 * Keycloak checks the flow before PKCE: with Standard flow off it sends
 * every probe back with `error=unauthorized_client`. Otherwise a probe
 * without a challenge, and one with `plain`, come back with
 * `error=invalid_request` from a client that requires S256 and with
 * `error=login_required` from one that does not.
 *
 * Runs after row 4. Without an accepted URI there is nothing to probe with
 * (`no_redirect_uri_accepted`); an unknown or disabled Web-Client
 * (`web_client_invalid`) or Standard flow off (`standard_flow_off`, row 3)
 * leave the probes meaningless.
 */

const { STATUS, finding, partOf, notCheckable } = require("../findings");
const { probeAuthorize, errorSentBackTo } = require("./authorize-probe");
const { firstAcceptedRedirectUri } = require("./redirect-uris-row");
const {
  WEB_CLIENT_INVALID,
  webClientUnknownOrDisabled,
} = require("./web-client-token-part");

const WEB_CLIENT_ROW = 2;
const PKCE_ROW = 3;
const AUTHORIZE = "authorize";

const REASONS = Object.freeze({
  STANDARD_FLOW_ON: "standard_flow_on",
  STANDARD_FLOW_OFF: "standard_flow_off",
  NO_REDIRECT_URI_ACCEPTED: "no_redirect_uri_accepted",
});

/**
 * The two probes of row 3: the method sent (`null`: no challenge at all)
 * and the reason when Keycloak refuses it (`invalid_request`) or lets it
 * pass (`login_required`).
 */
const PKCE_PROBES = Object.freeze([
  {
    label: "without_challenge",
    challengeMethod: null,
    refused: "pkce_required",
    passed: "pkce_optional",
  },
  {
    label: "plain",
    challengeMethod: "plain",
    refused: "pkce_plain_rejected",
    passed: "pkce_plain_accepted",
  },
]);

/**
 * The finding of the S256 probe: the flow is on when Keycloak sends it
 * back with `login_required`, or with `invalid_request` for a PKCE method
 * it does not require (row 3's business).
 *
 * @param {Object} result The probe result
 * @param {string} uri The probed redirect URI
 * @returns {Object} The finding
 */
function authorizeFinding(result, uri) {
  const error = errorSentBackTo(result, uri);
  if (error === "login_required" || error === "invalid_request") {
    return finding(STATUS.OK, REASONS.STANDARD_FLOW_ON);
  }
  if (error === "unauthorized_client") {
    return finding(STATUS.FAIL, REASONS.STANDARD_FLOW_OFF, { error });
  }
  return notCheckable(result);
}

/**
 * Sends one probe of row 3.
 *
 * @param {Object} context The check context
 * @param {string} uri The redirect URI
 * @param {Object} pkceProbe One of `PKCE_PROBES`
 * @returns {Promise<Object>} The part
 */
async function pkcePart(context, uri, pkceProbe) {
  const result = await probeAuthorize(context, uri, {
    challengeMethod: pkceProbe.challengeMethod,
  });
  const error = errorSentBackTo(result, uri);
  if (error === "invalid_request") {
    return partOf(pkceProbe.label, finding(STATUS.OK, pkceProbe.refused));
  }
  if (error === "login_required") {
    return partOf(pkceProbe.label, finding(STATUS.FAIL, pkceProbe.passed));
  }
  return partOf(pkceProbe.label, notCheckable(result));
}

/**
 * Row 3 with every part `na` for one reason.
 *
 * @param {import("../check-results").CheckResults} results The rows so far
 * @param {string} reason The reason
 */
function pkceNotCheckable(results, reason) {
  results.addParts(
    PKCE_ROW,
    PKCE_PROBES.map(({ label }) => partOf(label, finding(STATUS.NA, reason))),
  );
}

/**
 * Probes with the first accepted redirect URI, adds the `authorize` part
 * to row 2 and answers row 3.
 *
 * @param {Object} context The check context
 * @param {import("../check-results").CheckResults} results The rows so far
 * @returns {Promise<void>}
 */
async function evaluate(context, results) {
  const uri = firstAcceptedRedirectUri(results);
  let unprobed = null;
  if (webClientUnknownOrDisabled(results)) {
    unprobed = WEB_CLIENT_INVALID;
  } else if (!uri) {
    unprobed = REASONS.NO_REDIRECT_URI_ACCEPTED;
  }
  if (unprobed) {
    results.addParts(WEB_CLIENT_ROW, [
      partOf(AUTHORIZE, finding(STATUS.NA, unprobed)),
    ]);
    pkceNotCheckable(results, unprobed);
    return;
  }

  const authorize = authorizeFinding(await probeAuthorize(context, uri), uri);
  results.addParts(WEB_CLIENT_ROW, [partOf(AUTHORIZE, authorize)]);
  if (authorize.reason === REASONS.STANDARD_FLOW_OFF) {
    pkceNotCheckable(results, REASONS.STANDARD_FLOW_OFF);
    return;
  }
  results.addParts(
    PKCE_ROW,
    await Promise.all(
      PKCE_PROBES.map((pkceProbe) => pkcePart(context, uri, pkceProbe)),
    ),
  );
}

module.exports = {
  rowIds: () => [WEB_CLIENT_ROW, PKCE_ROW],
  evaluate,
};
