/**
 * Row 5, Valid Post Logout Redirect URIs (step „Rücksprungadressen und Web
 * Origins eintragen“, ECCdigital/tickets#98): Keycloak sends the browser
 * back to every post logout redirect URI the body names. One part per
 * entry, labelled with it as sent: the logout endpoint without
 * `id_token_hint` and without cookies redirects to an entry it accepts and
 * shows an error page (`400`) for one it does not. An entry ending in `*`
 * (the one of „Benutzer wechseln“) is probed without the `*` plus the
 * sample query `redirect=%2F`, the way Biletado sends it; an entry missing
 * its `*` in the realm is refused then.
 *
 * Runs after the `token` part of row 2: logout does not ask whether the
 * Web-Client is enabled, and refuses every URI of an unknown one.
 */

const { probe } = require("../probe-client");
const { STATUS, finding, partOf, notCheckable } = require("../findings");
const { randomValue } = require("./authorize-probe");
const {
  WEB_CLIENT_INVALID,
  webClientUnknownOrDisabled,
} = require("./web-client-token-part");

const ROW_ID = 5;

const REASONS = Object.freeze({
  POST_LOGOUT_REDIRECT_ACCEPTED: "post_logout_redirect_accepted",
  POST_LOGOUT_REDIRECT_REJECTED: "post_logout_redirect_rejected",
});

/** The sample query of an entry ending in `*`. */
const SAMPLE_QUERY = "redirect=%2F";

/**
 * The post logout redirect URIs of every app of the body, in its order.
 *
 * @param {Object} context The check context
 * @returns {string[]} The entries as sent
 */
function postLogoutUrisOf(context) {
  return context.apps.flatMap((app) => app.postLogoutRedirectUris);
}

/**
 * The URI to probe for an entry: an entry ending in `*` without it and with
 * the sample query.
 *
 * @param {string} entry The entry as sent
 * @returns {string} The URI
 */
function probedUriOf(entry) {
  if (!entry.endsWith("*")) return entry;
  const uri = entry.slice(0, -1);
  return `${uri}${uri.includes("?") ? "&" : "?"}${SAMPLE_QUERY}`;
}

/**
 * Whether a redirect leads to the probed URI: its `Location` is the URI,
 * alone or continued by a query.
 *
 * @param {Object} result The probe result
 * @param {string} uri The probed URI
 * @returns {boolean} Whether Keycloak accepted the URI
 */
function redirectsTo(result, uri) {
  const location = result.headers.location;
  if (result.status < 300 || result.status > 399) return false;
  if (typeof location !== "string") return false;
  const separator = uri.includes("?") ? "&" : "?";
  return location === uri || location.startsWith(`${uri}${separator}`);
}

/**
 * Probes one entry.
 *
 * @param {Object} context The check context
 * @param {string} entry The entry as sent
 * @returns {Promise<Object>} The part
 */
async function entryPart(context, entry) {
  const uri = probedUriOf(entry);
  const result = await probe({
    url: `${context.oidcBase}/logout`,
    query: {
      client_id: context.publicClient,
      post_logout_redirect_uri: uri,
      state: randomValue(),
    },
  });
  if (result.outcome === "response" && redirectsTo(result, uri)) {
    return partOf(
      entry,
      finding(STATUS.OK, REASONS.POST_LOGOUT_REDIRECT_ACCEPTED),
    );
  }
  if (result.outcome === "response" && result.status === 400) {
    return partOf(
      entry,
      finding(STATUS.FAIL, REASONS.POST_LOGOUT_REDIRECT_REJECTED, {
        httpStatus: 400,
      }),
    );
  }
  return partOf(entry, notCheckable(result));
}

/**
 * Probes every post logout redirect URI of the body and answers row 5.
 *
 * @param {Object} context The check context
 * @param {import("../check-results").CheckResults} results The rows so far
 * @returns {Promise<void>}
 */
async function evaluate(context, results) {
  const entries = postLogoutUrisOf(context);
  if (entries.length === 0) return;
  if (webClientUnknownOrDisabled(results)) {
    results.addParts(
      ROW_ID,
      entries.map((entry) =>
        partOf(entry, finding(STATUS.NA, WEB_CLIENT_INVALID)),
      ),
    );
    return;
  }
  results.addParts(
    ROW_ID,
    await Promise.all(entries.map((entry) => entryPart(context, entry))),
  );
}

module.exports = {
  // Without an entry in the body there is no row 5, as for row 4.
  rowIds: (context) => (postLogoutUrisOf(context).length > 0 ? [ROW_ID] : []),
  evaluate,
};
