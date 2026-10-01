/**
 * Row 4, Valid Redirect URIs (step „Rücksprungadressen und Web Origins
 * eintragen“, ECCdigital/tickets#98): Keycloak accepts every redirect URI
 * of every app the body names, and not its `http` variant. One part per
 * URI, labelled with it: the Authorize-Probe (`authorize-probe.js`) is
 * accepted when Keycloak sends it back to exactly that URI with any
 * `error`, and refused with an error page (`400`); an `https` URI is then
 * probed once more as `http`, which must be refused.
 *
 * Runs after the `token` part of row 2 (an unknown or disabled Web-Client
 * gets an error page for any URI) and before the `authorize` part of row 2
 * and row 3, which probe with the first URI accepted here.
 */

const { STATUS, finding, partOf, notCheckable } = require("../findings");
const { probeAuthorize, errorSentBackTo } = require("./authorize-probe");
const {
  WEB_CLIENT_INVALID,
  webClientUnknownOrDisabled,
} = require("./web-client-token-part");

const ROW_ID = 4;

const REASONS = Object.freeze({
  REDIRECT_URI_ACCEPTED: "redirect_uri_accepted",
  REDIRECT_URI_REJECTED: "redirect_uri_rejected",
  HTTP_ACCEPTED: "http_accepted",
});

/**
 * The redirect URIs of every app of the body, in its order.
 *
 * @param {Object} context The check context
 * @returns {string[]} The URIs
 */
function redirectUrisOf(context) {
  return context.apps.flatMap((app) => app.redirectUris);
}

/**
 * The URI with `http` for `https`.
 *
 * @param {string} uri An absolute URL
 * @returns {?string} The `http` variant, `null` for an `http` URI
 */
function httpVariantOf(uri) {
  return /^https:/i.test(uri) ? uri.replace(/^https:/i, "http:") : null;
}

/**
 * Probes one redirect URI, and its `http` variant once it is accepted.
 *
 * @param {Object} context The check context
 * @param {string} uri The redirect URI
 * @returns {Promise<Object>} The part
 */
async function uriPart(context, uri) {
  const result = await probeAuthorize(context, uri);
  if (!errorSentBackTo(result, uri)) {
    return partOf(
      uri,
      result.outcome === "response" && result.status === 400
        ? finding(STATUS.FAIL, REASONS.REDIRECT_URI_REJECTED, {
            httpStatus: 400,
          })
        : notCheckable(result),
    );
  }

  const httpUri = httpVariantOf(uri);
  if (!httpUri) {
    return partOf(uri, finding(STATUS.OK, REASONS.REDIRECT_URI_ACCEPTED));
  }
  const httpResult = await probeAuthorize(context, httpUri);
  if (errorSentBackTo(httpResult, httpUri)) {
    return partOf(
      uri,
      finding(STATUS.FAIL, REASONS.HTTP_ACCEPTED, { uri: httpUri }),
    );
  }
  if (httpResult.outcome === "response" && httpResult.status === 400) {
    return partOf(uri, finding(STATUS.OK, REASONS.REDIRECT_URI_ACCEPTED));
  }
  return partOf(uri, notCheckable(httpResult));
}

/**
 * Probes every redirect URI of the body and answers row 4.
 *
 * @param {Object} context The check context
 * @param {import("../check-results").CheckResults} results The rows so far
 * @returns {Promise<void>}
 */
async function evaluate(context, results) {
  const uris = redirectUrisOf(context);
  if (uris.length === 0) return;
  if (webClientUnknownOrDisabled(results)) {
    results.addParts(
      ROW_ID,
      uris.map((uri) => partOf(uri, finding(STATUS.NA, WEB_CLIENT_INVALID))),
    );
    return;
  }
  results.addParts(
    ROW_ID,
    await Promise.all(uris.map((uri) => uriPart(context, uri))),
  );
}

/**
 * The first redirect URI Keycloak accepted, in the order of the body: the
 * probe URI of row 2 (`authorize`) and row 3. One whose `http` variant was
 * accepted too counts, Keycloak sends the probe back to it all the same.
 *
 * @param {import("../check-results").CheckResults} results The rows so far
 * @returns {?string} The URI, `null` when Keycloak accepted none
 */
function firstAcceptedRedirectUri(results) {
  const accepted = [REASONS.REDIRECT_URI_ACCEPTED, REASONS.HTTP_ACCEPTED];
  return (
    results.get(ROW_ID)?.parts.find((part) => accepted.includes(part.reason))
      ?.label ?? null
  );
}

module.exports = {
  // A row of parts needs a part: without a redirect URI in the body there
  // is no row 4 (the Admin UI shows the addresses it could not send).
  rowIds: (context) => (redirectUrisOf(context).length > 0 ? [ROW_ID] : []),
  evaluate,
  firstAcceptedRedirectUri,
};
