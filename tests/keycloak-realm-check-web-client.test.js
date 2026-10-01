/**
 * „Realm prüfen“ (ECCdigital/tickets#98, #99): the rows of the Web-Client
 * in `POST /api/instances/keycloak/check`, over the lifecycle harness with
 * Keycloak faked per method and URL. The realm answers as Keycloak 26.7.3
 * and 26.8.0 did in the live test (`helpers/fake-keycloak-web-client.js`):
 * row 2 (the Web-Client exists, is public, has Standard flow), row 3
 * (PKCE S256 enforced), row 4 (Valid Redirect URIs), row 5 (Valid Post
 * Logout Redirect URIs) and row 6 (Web Origins, `direct` mode only).
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  ADMIN,
} = require("./helpers/booking-lifecycle-harness");
const KeycloakVerifier = require("../src/commons/utilities/keycloak-verifier");
const {
  FakeKeycloakHttp,
  json,
  discoveryDocument,
} = require("./helpers/fake-keycloak-http");
const { installWebClient } = require("./helpers/fake-keycloak-web-client");

const SERVER_URL = "https://idp.example.test";
const ISSUER = `${SERVER_URL}/realms/city`;
const OIDC = `${ISSUER}/protocol/openid-connect`;
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const WEB_CLIENT = "booking-client";

const ADMIN_ORIGIN = "https://booking.example.test";
const ADMIN_CALLBACK = `${ADMIN_ORIGIN}/admin/api/auth/sso/callback`;
const ADMIN_LOGIN = `${ADMIN_ORIGIN}/admin/login`;
const ADMIN_SWITCH = `${ADMIN_ORIGIN}/admin/api/auth/sso/login*`;
const PORTAL_ORIGIN = "https://portal.example.test";
const PORTAL_CALLBACK = `${PORTAL_ORIGIN}/api/auth/sso/callback`;
const PORTAL_SWITCH = `${PORTAL_ORIGIN}/api/auth/sso/login*`;

/** The stored Keycloak application of the instance. */
function keycloakApp(overrides = {}) {
  return {
    type: "auth",
    id: "keycloak",
    active: true,
    serverUrl: SERVER_URL,
    realm: "city",
    publicClient: WEB_CLIENT,
    privateClient: "backend",
    privateClientSecret: "secret",
    roleMapping: { active: false, roles: [] },
    ...overrides,
  };
}

/** A request body as the Admin UI sends it, by default in BFF mode. */
function checkBody(overrides = {}) {
  return {
    mode: "bff",
    apps: [
      {
        app: "adminUi",
        origin: ADMIN_ORIGIN,
        redirectUris: [ADMIN_CALLBACK],
        postLogoutRedirectUris: [ADMIN_LOGIN, ADMIN_SWITCH],
      },
      {
        app: "storefront",
        origin: PORTAL_ORIGIN,
        redirectUris: [PORTAL_CALLBACK],
        postLogoutRedirectUris: [PORTAL_SWITCH],
      },
    ],
    ...overrides,
  };
}

/** The Web-Client as the setup guide has it, for the addresses of `checkBody`. */
function guideClient(overrides = {}) {
  return {
    clientId: WEB_CLIENT,
    redirectUris: [ADMIN_CALLBACK, PORTAL_CALLBACK],
    postLogoutRedirectUris: [ADMIN_LOGIN, ADMIN_SWITCH, PORTAL_SWITCH],
    webOrigins: [ADMIN_ORIGIN, PORTAL_ORIGIN],
    ...overrides,
  };
}

describe("POST /api/instances/keycloak/check, the Web-Client", function () {
  this.timeout(20000);

  let h;
  let keycloak;

  beforeEach(async function () {
    h = await installHarness({ instance: { applications: [keycloakApp()] } });
    keycloak = new FakeKeycloakHttp().install();
    keycloak.on("GET", DISCOVERY, json(200, discoveryDocument(ISSUER)));
  });

  afterEach(async function () {
    sinon.restore();
    KeycloakVerifier.clearCache();
    await h.close();
    keycloak.verify();
  });

  /** The rows of a check, by id. */
  async function check(body = checkBody()) {
    const res = await h
      .api()
      .post("/api/instances/keycloak/check")
      .set(h.as(ADMIN))
      .send(body);
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    return Object.fromEntries(res.body.rows.map((row) => [row.id, row]));
  }

  /** One part of a row, by its label. */
  const partOf = (row, label) => row.parts.find((part) => part.label === label);

  /** The requests to an endpoint of the realm. */
  const requestsTo = (method, endpoint) =>
    keycloak.requests.filter(
      (r) => r.method === method && r.path === `${OIDC}/${endpoint}`,
    );

  describe("row 2, token part: the Web-Client exists and is public", function () {
    it("is met when the token endpoint refuses the dummy code, asked without secret and without Origin", async function () {
      installWebClient(keycloak, ISSUER, guideClient());

      const rows = await check();

      expect(partOf(rows[2], "token")).to.deep.equal({
        label: "token",
        status: "ok",
        reason: "client_public",
      });
      const [probe] = requestsTo("POST", "token");
      expect(probe.form).to.have.keys(
        "grant_type",
        "client_id",
        "code",
        "redirect_uri",
        "code_verifier",
      );
      expect(probe.form).to.include({
        grant_type: "authorization_code",
        client_id: WEB_CLIENT,
        code: "x",
        redirect_uri: ADMIN_CALLBACK,
      });
      expect(probe.form.code_verifier).to.match(/^[A-Za-z0-9_-]{43}$/);
      expect(probe.headers).not.to.have.property("origin");
      expect(probe.headers).not.to.have.property("authorization");
    });

    for (const client of ["unknown", "disabled"]) {
      it(`is not met for a Web-Client that is ${client}`, async function () {
        installWebClient(keycloak, ISSUER, guideClient({ client }));

        const rows = await check();

        expect(partOf(rows[2], "token")).to.deep.equal({
          label: "token",
          status: "fail",
          reason: "client_unknown_or_disabled",
          details: { httpStatus: 401, error: "invalid_client" },
        });
        expect(rows[2].status).to.equal("fail");
      });
    }

    it("is not met while Client authentication is on", async function () {
      installWebClient(
        keycloak,
        ISSUER,
        guideClient({ client: "confidential" }),
      );

      const rows = await check();

      expect(partOf(rows[2], "token")).to.deep.equal({
        label: "token",
        status: "fail",
        reason: "client_authentication_on",
        details: { httpStatus: 401, error: "unauthorized_client" },
      });
    });

    it("is not checkable for an answer it does not know, with the status and the error", async function () {
      const client = installWebClient(keycloak, ISSUER, guideClient());
      keycloak.on("POST", `${OIDC}/token`, (req) =>
        req.form.grant_type === "authorization_code"
          ? json(403, { error: "Invalid origin" })
          : client.token(req),
      );

      const rows = await check();

      expect(partOf(rows[2], "token")).to.deep.equal({
        label: "token",
        status: "na",
        reason: "unexpected_response",
        details: { httpStatus: 403, error: "Invalid origin" },
      });
    });

    it("sends no redirect_uri when the body names none", async function () {
      installWebClient(keycloak, ISSUER, guideClient());

      const rows = await check({ mode: "direct", apps: [] });

      expect(partOf(rows[2], "token").reason).to.equal("client_public");
      const [probe] = requestsTo("POST", "token");
      expect(probe.form).not.to.have.property("redirect_uri");
    });
  });
});
