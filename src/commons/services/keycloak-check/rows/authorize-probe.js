/**
 * The Authorize-Probe of „Realm prüfen“, shared by row 4 (ECCdigital/tickets
 * #98) and rows 2 and 3 (#99): `GET OIDC/auth` with the Web-Client, a
 * redirect URI, `prompt=none` and a PKCE challenge, without cookies. As
 * nobody is signed in, Keycloak never issues a code: it either refuses the
 * redirect URI with an error page (`400`), or it sends the browser back to
 * exactly that URI with an `error` - `login_required`, or what it found
 * wrong with the client (`unauthorized_client` for Standard flow off,
 * `invalid_request` for a PKCE method it does not require). It checks the
 * redirect URI first, the flow next, PKCE last.
 */

const crypto = require("crypto");

const { probe } = require("../probe-client");

/**
 * A random value of 43 URL-safe characters, as long as a PKCE verifier or
 * challenge must be at least; also a probe's `state`.
 *
 * @returns {string} The value
 */
function randomValue() {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Sends the Authorize-Probe.
 *
 * @param {Object} context The check context
 * @param {string} redirectUri The redirect URI to send back to
 * @param {Object} [options]
 * @param {?string} [options.challengeMethod="S256"] The PKCE method,
 *   `S256` or `plain`; `null` sends no challenge at all
 * @returns {Promise<Object>} The probe result
 */
function probeAuthorize(
  context,
  redirectUri,
  { challengeMethod = "S256" } = {},
) {
  const query = {
    client_id: context.publicClient,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: randomValue(),
    prompt: "none",
  };
  if (challengeMethod) {
    query.code_challenge = randomValue();
    query.code_challenge_method = challengeMethod;
  }
  return probe({ url: `${context.oidcBase}/auth`, query });
}

/**
 * The `error` with which Keycloak sent the probe back to the redirect URI:
 * only of a `302` whose `Location` is exactly the URI followed by `?` (or
 * `&` when the URI has a query of its own).
 *
 * @param {Object} result The probe result
 * @param {string} redirectUri The probed redirect URI
 * @returns {?string} The `error` parameter, `null` for any other answer
 */
function errorSentBackTo(result, redirectUri) {
  if (result.outcome !== "response" || result.status !== 302) return null;
  const location = result.headers.location;
  const separator = redirectUri.includes("?") ? "&" : "?";
  if (
    typeof location !== "string" ||
    !location.startsWith(`${redirectUri}${separator}`)
  ) {
    return null;
  }
  return new URL(location).searchParams.get("error") || null;
}

module.exports = { randomValue, probeAuthorize, errorSentBackTo };
