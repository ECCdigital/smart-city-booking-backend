/**
 * Row 2, `token` part (step „Web-Client anlegen“, ECCdigital/tickets#99):
 * the Web-Client exists, is enabled and is public. The token endpoint is
 * asked to redeem a dummy code without a secret and without an `Origin`
 * (Keycloak refuses any grant with an unlisted `Origin`): a public client
 * gets `400 invalid_grant`, an unknown or disabled one
 * `401 invalid_client`, one with Client authentication on
 * `401 unauthorized_client`.
 *
 * Runs before row 4, and the rows after it read it: an unknown or disabled
 * Web-Client makes the probes of rows 2 (`authorize`), 3, 4, 5 and 6
 * meaningless (`web_client_invalid`), a client that is not public row 6.
 */

const { probe } = require("../probe-client");
const { STATUS, finding, partOf, notCheckable } = require("../findings");
const { randomValue } = require("./authorize-probe");

const ROW_ID = 2;
const LABEL = "token";

const REASONS = Object.freeze({
  CLIENT_PUBLIC: "client_public",
  CLIENT_UNKNOWN_OR_DISABLED: "client_unknown_or_disabled",
  CLIENT_AUTHENTICATION_ON: "client_authentication_on",
});

/**
 * The reason of a probe the Web-Client's state makes meaningless, always
 * with `na`.
 */
const WEB_CLIENT_INVALID = "web_client_invalid";

/**
 * The first redirect URI of the body, in the order of its apps.
 *
 * @param {Object} context The check context
 * @returns {?string} The URI, `null` when the body names none
 */
function firstRedirectUri(context) {
  return context.apps.flatMap((app) => app.redirectUris)[0] || null;
}

/**
 * The finding of the token probe.
 *
 * @param {Object} result The probe result
 * @returns {Object} The finding
 */
function tokenFinding(result) {
  if (result.outcome !== "response") return notCheckable(result);
  const error = result.data?.error;

  if (result.status === 400 && error === "invalid_grant") {
    return finding(STATUS.OK, REASONS.CLIENT_PUBLIC);
  }
  if (result.status === 401 && error === "invalid_client") {
    return finding(STATUS.FAIL, REASONS.CLIENT_UNKNOWN_OR_DISABLED, {
      httpStatus: 401,
      error,
    });
  }
  if (result.status === 401 && error === "unauthorized_client") {
    return finding(STATUS.FAIL, REASONS.CLIENT_AUTHENTICATION_ON, {
      httpStatus: 401,
      error,
    });
  }
  return notCheckable(result);
}

/**
 * Probes the token endpoint with a dummy code and adds the `token` part to
 * row 2.
 *
 * @param {Object} context The check context
 * @param {import("../check-results").CheckResults} results The rows so far
 * @returns {Promise<void>}
 */
async function evaluate(context, results) {
  const form = {
    grant_type: "authorization_code",
    client_id: context.publicClient,
    code: "x",
  };
  const redirectUri = firstRedirectUri(context);
  if (redirectUri) form.redirect_uri = redirectUri;
  form.code_verifier = randomValue();

  const result = await probe({
    method: "POST",
    url: `${context.oidcBase}/token`,
    form,
  });
  results.addParts(ROW_ID, [partOf(LABEL, tokenFinding(result))]);
}

/**
 * Whether the token part found the Web-Client unknown or disabled.
 *
 * @param {import("../check-results").CheckResults} results The rows so far
 * @returns {boolean} Whether the probes of the Web-Client are meaningless
 */
function webClientUnknownOrDisabled(results) {
  return (
    results.part(ROW_ID, LABEL)?.reason === REASONS.CLIENT_UNKNOWN_OR_DISABLED
  );
}

/**
 * Whether the token part found the Web-Client public.
 *
 * @param {import("../check-results").CheckResults} results The rows so far
 * @returns {boolean} Whether it is known, enabled and public
 */
function webClientPublic(results) {
  return results.part(ROW_ID, LABEL)?.reason === REASONS.CLIENT_PUBLIC;
}

module.exports = {
  rowIds: () => [ROW_ID],
  evaluate,
  WEB_CLIENT_INVALID,
  webClientUnknownOrDisabled,
  webClientPublic,
};
