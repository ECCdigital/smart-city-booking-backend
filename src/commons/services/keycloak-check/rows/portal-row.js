/**
 * Row 10, Portal-URL (step „Portal-URL prüfen“, ECCdigital/tickets#101):
 * the Storefront under the stored Portal-URL knows the address it is reached
 * at. Its SSO sign-in sends the browser to the stored realm's authorize
 * endpoint with a `redirect_uri`; that must be the Storefront's callback
 * after sign-in the guide shows (the body's storefront entry).
 */

const { probe } = require("../probe-client");
const { STATUS, finding, originAndPath, notCheckable } = require("../findings");

const ROW_ID = 10;

/**
 * The Storefront's SSO sign-in, a fixed path under the Portal-URL
 * (`server/api/auth/sso/login.get.ts` in smart-city-booking-store-front).
 * When the Storefront's SSO paths change, this path changes with them: see
 * smart-city-booking-vue-app docs/agents/keycloak-realm.md (the list of
 * places that have to follow).
 */
const SSO_LOGIN_PATH = "/api/auth/sso/login";

/**
 * Probes the Storefront's SSO sign-in under the stored Portal-URL and
 * answers row 10.
 *
 * @param {Object} context The check context
 * @param {import("../check-results").CheckResults} results The rows so far
 * @returns {Promise<void>}
 */
async function evaluate(context, results) {
  const portalOrigin = portalOriginOf(context.portalUrl);
  const expected = context.apps.find((app) => app.app === "storefront")
    ?.redirectUris[0];
  if (!portalOrigin || !expected) {
    results.set(ROW_ID, finding(STATUS.NA, "portal_url_missing"));
    return;
  }
  // Only ever the stored Portal-URL, never the storefront origin of the body.
  const result = await probe({ url: `${portalOrigin}${SSO_LOGIN_PATH}` });
  results.set(ROW_ID, portalFinding(context, expected, result));
}

/**
 * The origin of the stored Portal-URL, `null` without one or for a value
 * that is no absolute http(s) URL (the Portal tab stores what it is given).
 *
 * @param {?string} portalUrl The stored Portal-URL
 * @returns {?string} The origin
 */
function portalOriginOf(portalUrl) {
  let url;
  try {
    url = new URL(String(portalUrl ?? "").trim());
  } catch {
    return null;
  }
  return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
}

/**
 * The finding of the Storefront's answer.
 *
 * @param {Object} context The check context
 * @param {string} expected The storefront's callback of the body
 * @param {Object} result The probe result
 * @returns {Object} The finding
 */
function portalFinding(context, expected, result) {
  if (result.outcome !== "response") return notCheckable(result);

  const location = redirectTargetOf(result);
  const toRealm =
    location !== null &&
    originAndPath(location.href) === `${context.oidcBase}/auth`;
  const actual = toRealm ? location.searchParams.get("redirect_uri") : null;
  if (!actual) {
    const details = { httpStatus: result.status };
    if (location) details.location = originAndPath(location.href);
    return finding(STATUS.NA, "storefront_not_redirecting", details);
  }
  return comparisonFinding(expected, actual);
}

/**
 * Where a redirect points, resolved against the probed address; `null`
 * for an answer that is no redirect or carries no readable `Location`.
 *
 * @param {Object} result The probe result
 * @returns {?URL} The target
 */
function redirectTargetOf(result) {
  const location = result.headers.location;
  if (result.status < 300 || result.status >= 400 || !location) return null;
  try {
    return new URL(location, result.url);
  } catch {
    return null;
  }
}

/**
 * The origin (scheme, host, port) of a URL, `null` for anything that is
 * no absolute URL.
 *
 * @param {string} url The URL
 * @returns {?string} The origin
 */
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The finding of the `redirect_uri` the Storefront sends, held against the
 * callback the guide shows: equal is met; another origin means the
 * Portal-URL or the Storefront is set up wrong; the same origin with
 * another path or query is a Biletado bug, not the realm's, so not
 * checkable.
 *
 * @param {string} expected The storefront's callback of the body
 * @param {string} actual The `redirect_uri` of the Storefront's redirect
 * @returns {Object} The finding
 */
function comparisonFinding(expected, actual) {
  const details = { expected, actual };
  if (actual === expected) {
    return finding(STATUS.OK, "storefront_redirect_matches", details);
  }
  if (originOf(actual) !== originOf(expected)) {
    return finding(STATUS.FAIL, "storefront_origin_mismatch", details);
  }
  return finding(STATUS.NA, "storefront_path_mismatch", details);
}

module.exports = {
  rowIds: () => [ROW_ID],
  evaluate,
};
