/**
 * A Web-Client of a realm as Keycloak 26.7.3 and 26.8.0 answer its probes,
 * on top of `FakeKeycloakHttp`: the authorize, token and logout endpoints
 * answered per request the way the live test of ECCdigital/tickets#103
 * observed them (`103-findings.md`, rows 2 to 6). A test describes the
 * client as the realm holds it and reads the rows; to put one odd answer
 * on the wire it wraps an endpoint:
 *
 *   const client = installWebClient(keycloak, ISSUER, { pkce: "plain" });
 *   keycloak.on("GET", `${OIDC}/auth`, (req) =>
 *     req.query.code_challenge_method === "plain"
 *       ? json(500, { error: "unknown_error" })
 *       : client.authorize(req));
 *
 * Valid Redirect URIs and Valid Post Logout Redirect URIs compare like
 * Keycloak: an entry is the whole URI, query included; an entry ending in
 * `*` is a prefix (`*` alone allows everything). Web Origins are origins,
 * `*` allows every origin.
 */

const { json, html, redirect } = require("./fake-keycloak-http");

/**
 * The client as the realm holds it, by default as the setup guide has it.
 *
 * @typedef {Object} WebClientConfig
 * @property {string} [clientId="booking-client"] Its Client ID
 * @property {string} [client="public"] `public`, `confidential` (Client
 *   authentication on), `disabled` or `unknown` (no such client)
 * @property {boolean} [standardFlow=true] Standard flow enabled
 * @property {?string} [pkce="S256"] The PKCE method it requires, `S256`,
 *   `plain` or `null` (none)
 * @property {string[]} [redirectUris=[]] Valid Redirect URIs
 * @property {string[]} [postLogoutRedirectUris=[]] Valid Post Logout
 *   Redirect URIs
 * @property {string[]} [webOrigins=[]] Web Origins
 */

/** Whether a URI matches a list of Keycloak entries. */
function listed(entries, uri) {
  return entries.some((entry) =>
    entry.endsWith("*") ? uri.startsWith(entry.slice(0, -1)) : uri === entry,
  );
}

/** A URI continued by query parameters, after `?` or `&`. */
function continued(uri, params) {
  const separator = uri.includes("?") ? "&" : "?";
  return `${uri}${separator}${new URLSearchParams(params)}`;
}

/**
 * Answers the Web-Client's endpoints of the realm `issuer` on `keycloak`.
 *
 * @param {import("./fake-keycloak-http").FakeKeycloakHttp} keycloak The fake
 * @param {string} issuer `<serverUrl>/realms/<realm>`
 * @param {WebClientConfig} [config] The client
 * @returns {{authorize: Function, token: Function, logout: Function}} The
 *   answer of each endpoint as a function of the request, to wrap
 */
function installWebClient(keycloak, issuer, config = {}) {
  const {
    clientId = "booking-client",
    client = "public",
    standardFlow = true,
    pkce = "S256",
    redirectUris = [],
    postLogoutRedirectUris = [],
    webOrigins = [],
  } = config;
  const oidc = `${issuer}/protocol/openid-connect`;
  const known = (id) => client !== "unknown" && id === clientId;
  const usable = (id) => known(id) && client !== "disabled";

  /** `GET OIDC/auth`: flow and PKCE are checked after the redirect URI. */
  const authorize = ({ query }) => {
    if (!usable(query.client_id)) return html(400);
    if (!listed(redirectUris, query.redirect_uri)) return html(400);
    const back = (error) =>
      redirect(
        continued(query.redirect_uri, {
          error,
          state: query.state,
          iss: issuer,
        }),
      );
    if (!standardFlow) return back("unauthorized_client");
    if (pkce && query.code_challenge_method !== pkce) {
      return back("invalid_request");
    }
    return back("login_required");
  };

  /**
   * `POST OIDC/token`: the client first (an `Origin` is echoed then),
   * then the `Origin` of every grant, then the grant itself.
   */
  const token = ({ form, headers }) => {
    const origin = headers.origin;
    const echo = origin ? { "access-control-allow-origin": origin } : {};
    if (!usable(form.client_id)) {
      return json(401, { error: "invalid_client" }, echo);
    }
    if (client === "confidential") {
      return json(401, { error: "unauthorized_client" }, echo);
    }
    if (origin && !webOrigins.includes("*") && !webOrigins.includes(origin)) {
      return json(403, { error: "Invalid origin" });
    }
    return json(400, { error: "invalid_grant" }, echo);
  };

  /** `GET OIDC/logout`: does not ask whether the client is enabled. */
  const logout = ({ query }) => {
    if (!known(query.client_id)) return html(400);
    const uri = query.post_logout_redirect_uri;
    if (!listed(postLogoutRedirectUris, uri)) return html(400);
    return redirect(continued(uri, { state: query.state }));
  };

  keycloak.on("GET", `${oidc}/auth`, authorize);
  keycloak.on("POST", `${oidc}/token`, token);
  keycloak.on("GET", `${oidc}/logout`, logout);
  return { authorize, token, logout };
}

module.exports = { installWebClient };
