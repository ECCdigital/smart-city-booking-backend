/**
 * Row 6, Web Origins, `direct` mode only (step „Rücksprungadressen und Web
 * Origins eintragen“, ECCdigital/tickets#98): the Admin UI, which talks to
 * Keycloak from the browser in `direct` mode, may do so from each of its
 * origins. One part per `adminUi` origin, labelled with it: the token
 * endpoint is asked to refresh a dummy token with that `Origin` - the only
 * probe of the check that sends one. An allowed origin gets
 * `400 invalid_grant` with `Access-Control-Allow-Origin` equal to it, an
 * unlisted one `403` (Keycloak >= 26.7.3) or a `400` without the header.
 *
 * Runs after the `token` part of row 2: Keycloak echoes every `Origin` to a
 * client it refuses with `401` (unknown, disabled, Client authentication
 * on), so the row is only probed for a public Web-Client.
 */

const { probe } = require("../probe-client");
const { STATUS, finding, partOf, notCheckable } = require("../findings");
const {
  WEB_CLIENT_INVALID,
  webClientPublic,
} = require("./web-client-token-part");

const ROW_ID = 6;

const REASONS = Object.freeze({
  ORIGIN_ALLOWED: "origin_allowed",
  ORIGIN_NOT_ALLOWED: "origin_not_allowed",
});

/**
 * The origins of the Admin UI in the body, in its order; none outside
 * `direct` mode.
 *
 * @param {Object} context The check context
 * @returns {string[]} The origins
 */
function adminUiOriginsOf(context) {
  if (context.mode !== "direct") return [];
  return context.apps
    .filter((app) => app.app === "adminUi")
    .map((app) => app.origin);
}

/**
 * The finding of the token probe with an `Origin`.
 *
 * @param {Object} result The probe result
 * @param {string} origin The origin sent
 * @returns {Object} The finding
 */
function originFinding(result, origin) {
  if (result.outcome !== "response") return notCheckable(result);

  if (result.status === 401) {
    const error = result.data?.error;
    return finding(STATUS.NA, WEB_CLIENT_INVALID, {
      httpStatus: 401,
      ...(typeof error === "string" && { error }),
    });
  }
  if (result.status === 400) {
    return result.headers["access-control-allow-origin"] === origin
      ? finding(STATUS.OK, REASONS.ORIGIN_ALLOWED)
      : finding(STATUS.FAIL, REASONS.ORIGIN_NOT_ALLOWED, { httpStatus: 400 });
  }
  if (result.status === 403) {
    return finding(STATUS.FAIL, REASONS.ORIGIN_NOT_ALLOWED, {
      httpStatus: 403,
    });
  }
  return notCheckable(result);
}

/**
 * Probes the token endpoint with one origin.
 *
 * @param {Object} context The check context
 * @param {string} origin The origin
 * @returns {Promise<Object>} The part
 */
async function originPart(context, origin) {
  const result = await probe({
    method: "POST",
    url: `${context.oidcBase}/token`,
    headers: { Origin: origin },
    form: {
      grant_type: "refresh_token",
      client_id: context.publicClient,
      refresh_token: "x",
    },
  });
  return partOf(origin, originFinding(result, origin));
}

/**
 * Probes every origin of the Admin UI and answers row 6.
 *
 * @param {Object} context The check context
 * @param {import("../check-results").CheckResults} results The rows so far
 * @returns {Promise<void>}
 */
async function evaluate(context, results) {
  const origins = adminUiOriginsOf(context);
  if (origins.length === 0) return;
  if (!webClientPublic(results)) {
    results.addParts(
      ROW_ID,
      origins.map((origin) =>
        partOf(origin, finding(STATUS.NA, WEB_CLIENT_INVALID)),
      ),
    );
    return;
  }
  results.addParts(
    ROW_ID,
    await Promise.all(origins.map((origin) => originPart(context, origin))),
  );
}

module.exports = {
  // `direct` mode only; without an Admin UI entry there is no row 6, as
  // for row 4.
  rowIds: (context) => (adminUiOriginsOf(context).length > 0 ? [ROW_ID] : []),
  evaluate,
};
