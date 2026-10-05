/**
 * A realm set up as the guide says, on top of `FakeKeycloakHttp`: an answer
 * for every probe of „Realm prüfen“ that passes, the way Keycloak 26.7.3 and
 * 26.8.0 answered them for the realm `good` of the live test of
 * ECCdigital/tickets#103 (`103-findings.md`), and the Storefront's sign-in
 * under the stored Portal-URL. Every realm check test file installs it in
 * `beforeEach`, so that all rows run, and then puts the answers of the rows
 * it is about on the wire: a later `keycloak.on(...)` for the same method
 * and URL replaces the realm's route. One endpoint serves several rows (the
 * token endpoint: rows 2, 6 and 7), so to change one probe's answer, wrap
 * the realm's:
 *
 *   const realm = installRealm(keycloak, ISSUER, { apps: checkBody().apps });
 *   keycloak.on("POST", `${OIDC}/token`, (req) =>
 *     req.form.grant_type === "client_credentials"
 *       ? json(401, { error: "invalid_client" })
 *       : realm.token(req));
 *
 * What passes, row by row:
 * - 1: the discovery names exactly the realm as issuer.
 * - 2 to 6: the Web-Client `booking-client` of `fake-keycloak-web-client.js`
 *   (public, Standard flow on, PKCE S256), listing the addresses of `apps`
 *   (the request body's): every redirect URI, every post logout redirect
 *   URI, every origin as Web Origin.
 * - 7: the API client may introspect: a dummy token is inactive. Its client
 *   credentials grant (sent only after a refused introspection) is refused
 *   as Keycloak does with Service accounts off.
 * - 8: any other token is active for the API client.
 * - 10, with `portalUrl`: the Storefront sends its sign-in to the realm with
 *   its callback under the Portal-URL's origin.
 */

const { json, redirect, discoveryDocument } = require("./fake-keycloak-http");
const { installWebClient } = require("./fake-keycloak-web-client");

/** The Client ID of the Web-Client (PUB) every test stores. */
const WEB_CLIENT = "booking-client";

/**
 * The Storefront's redirect of its SSO sign-in to Keycloak's authorize
 * endpoint, the way its `server/api/auth/sso/login.get.ts` builds it (h3
 * `sendRedirect`, 302, query in this order).
 *
 * @param {string} redirectUri The `redirect_uri` it sends
 * @param {string} authorize The authorize endpoint it knows
 * @returns {Object} The answer
 */
function storefrontRedirect(redirectUri, authorize) {
  const location = new URL(authorize);
  location.searchParams.set("client_id", WEB_CLIENT);
  location.searchParams.set("response_type", "code");
  location.searchParams.set("scope", "openid email profile");
  location.searchParams.set("redirect_uri", redirectUri);
  location.searchParams.set("state", "0123456789abcdef0123456789abcdef");
  location.searchParams.set(
    "code_challenge",
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
  location.searchParams.set("code_challenge_method", "S256");
  return redirect(location.href);
}

/**
 * Answers every probe of a good realm `issuer` on `keycloak`.
 *
 * @param {import("./fake-keycloak-http").FakeKeycloakHttp} keycloak The fake
 * @param {string} issuer `<serverUrl>/realms/<realm>`
 * @param {Object} [options]
 * @param {Object[]} [options.apps=[]] The `apps` of the request body, whose
 *   addresses the Web-Client lists
 * @param {?string} [options.portalUrl=null] The stored Portal-URL; without
 *   one, no Storefront answers
 * @returns {{discovery: Object, authorize: Function, token: Function,
 *   logout: Function, introspect: Function, storefrontLogin: ?Object}} The
 *   answer of each route, to wrap
 */
function installRealm(keycloak, issuer, { apps = [], portalUrl = null } = {}) {
  const oidc = `${issuer}/protocol/openid-connect`;

  const discovery = json(200, discoveryDocument(issuer));
  keycloak.on("GET", `${issuer}/.well-known/openid-configuration`, discovery);

  const webClient = installWebClient(keycloak, issuer, {
    clientId: WEB_CLIENT,
    redirectUris: apps.flatMap((app) => app.redirectUris),
    postLogoutRedirectUris: apps.flatMap((app) => app.postLogoutRedirectUris),
    webOrigins: apps.map((app) => app.origin),
  });

  /** `POST OIDC/token`: the API client's grant, else the Web-Client's. */
  const token = (req) =>
    req.form?.grant_type === "client_credentials"
      ? json(401, {
          error: "unauthorized_client",
          error_description: "Client not enabled to retrieve service account",
        })
      : webClient.token(req);
  keycloak.on("POST", `${oidc}/token`, token);

  /** `POST OIDC/token/introspect` as the API client. */
  const introspect = (req) => json(200, { active: req.form?.token !== "x" });
  keycloak.on("POST", `${oidc}/token/introspect`, introspect);

  let storefrontLogin = null;
  if (portalUrl) {
    const portal = new URL(portalUrl).origin;
    storefrontLogin = storefrontRedirect(
      `${portal}/api/auth/sso/callback`,
      `${oidc}/auth`,
    );
    keycloak.on("GET", `${portal}/api/auth/sso/login`, storefrontLogin);
  }

  return {
    discovery,
    authorize: webClient.authorize,
    token,
    logout: webClient.logout,
    introspect,
    storefrontLogin,
  };
}

module.exports = { installRealm, storefrontRedirect };
