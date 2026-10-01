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
  html,
  redirect,
  timeout,
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

  describe("what the rows touch", function () {
    it("requests only the stored Keycloak-URL, never an address of the body, and only row 6 sends an Origin", async function () {
      installWebClient(keycloak, ISSUER, guideClient());
      const body = {
        mode: "direct",
        apps: [
          {
            app: "adminUi",
            origin: "http://169.254.169.254",
            redirectUris: ["http://169.254.169.254/latest/meta-data"],
            postLogoutRedirectUris: ["http://localhost:6379/*"],
          },
          {
            app: "storefront",
            origin: "https://internal.example.test",
            redirectUris: ["https://internal.example.test/callback"],
            postLogoutRedirectUris: ["https://internal.example.test/logout"],
          },
        ],
      };

      const rows = await check(body);

      expect(Object.keys(rows)).to.include.members(["2", "4", "5", "6"]);
      keycloak.requests.forEach((r) => {
        expect(r.path.startsWith(`${ISSUER}/`), r.url).to.equal(true);
      });
      const withOrigin = keycloak.requests.filter((r) => r.headers.origin);
      expect(
        withOrigin.map((r) => [r.method, r.path, r.form.grant_type]),
      ).to.deep.equal([["POST", `${OIDC}/token`, "refresh_token"]]);
      expect(withOrigin[0].headers.origin).to.equal("http://169.254.169.254");
    });

    it("answers rows 2 to 6 as not checkable without probing when the realm is unavailable", async function () {
      keycloak.on(
        "GET",
        DISCOVERY,
        json(404, { error: "Realm does not exist" }),
      );

      const rows = await check(checkBody({ mode: "direct" }));

      for (const id of [2, 4, 5, 6]) {
        expect(rows[id], `row ${id}`).to.deep.equal({
          id,
          status: "na",
          reason: "realm_unavailable",
        });
      }
      expect(keycloak.requests.map((r) => r.url)).to.deep.equal([DISCOVERY]);
    });
  });

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

  describe("row 4, Valid Redirect URIs", function () {
    /** The authorize probes for one redirect URI. */
    const authorizeProbesFor = (uri) =>
      requestsTo("GET", "auth").filter((r) => r.query.redirect_uri === uri);

    it("is met when Keycloak sends every redirect URI of every app back to itself, and refuses its http variant", async function () {
      installWebClient(keycloak, ISSUER, guideClient());

      const rows = await check();

      expect(rows[4]).to.deep.equal({
        id: 4,
        status: "ok",
        reason: "redirect_uri_accepted",
        parts: [
          {
            label: ADMIN_CALLBACK,
            status: "ok",
            reason: "redirect_uri_accepted",
          },
          {
            label: PORTAL_CALLBACK,
            status: "ok",
            reason: "redirect_uri_accepted",
          },
        ],
      });
      const [probe] = authorizeProbesFor(ADMIN_CALLBACK);
      expect(probe.query).to.have.keys(
        "client_id",
        "redirect_uri",
        "response_type",
        "scope",
        "state",
        "prompt",
        "code_challenge",
        "code_challenge_method",
      );
      expect(probe.query).to.include({
        client_id: WEB_CLIENT,
        response_type: "code",
        scope: "openid email profile",
        prompt: "none",
        code_challenge_method: "S256",
      });
      expect(probe.query.code_challenge).to.match(/^[A-Za-z0-9_-]{43}$/);
      expect(probe.query.state).to.match(/^[A-Za-z0-9_-]{43}$/);
      expect(probe.headers).not.to.have.property("origin");
      expect(
        authorizeProbesFor(
          "http://booking.example.test/admin/api/auth/sso/callback",
        ),
      ).to.have.length(1);
    });

    it("is not met when Keycloak refuses a redirect URI with its error page", async function () {
      installWebClient(
        keycloak,
        ISSUER,
        guideClient({ redirectUris: [ADMIN_CALLBACK] }),
      );

      const rows = await check();

      expect(rows[4].status).to.equal("fail");
      expect(rows[4].reason).to.equal("redirect_uri_rejected");
      expect(rows[4].parts).to.deep.equal([
        {
          label: ADMIN_CALLBACK,
          status: "ok",
          reason: "redirect_uri_accepted",
        },
        {
          label: PORTAL_CALLBACK,
          status: "fail",
          reason: "redirect_uri_rejected",
          details: { httpStatus: 400 },
        },
      ]);
      expect(
        authorizeProbesFor("http://portal.example.test/api/auth/sso/callback"),
      ).to.deep.equal([]);
    });

    it("is not met when Keycloak accepts the http variant too, naming it", async function () {
      installWebClient(keycloak, ISSUER, guideClient({ redirectUris: ["*"] }));

      const rows = await check();

      expect(partOf(rows[4], ADMIN_CALLBACK)).to.deep.equal({
        label: ADMIN_CALLBACK,
        status: "fail",
        reason: "http_accepted",
        details: {
          uri: "http://booking.example.test/admin/api/auth/sso/callback",
        },
      });
    });

    it("accepts a redirect URI with a query of its own when Keycloak continues it with &", async function () {
      const withQuery = `${ADMIN_CALLBACK}?tenant=city`;
      installWebClient(
        keycloak,
        ISSUER,
        guideClient({ redirectUris: [withQuery] }),
      );
      const body = checkBody();
      body.apps[0].redirectUris = [withQuery];

      const rows = await check(body);

      expect(partOf(rows[4], withQuery)).to.deep.equal({
        label: withQuery,
        status: "ok",
        reason: "redirect_uri_accepted",
      });
    });

    it("probes an http redirect URI without a variant", async function () {
      const httpCallback = "http://localhost:8080/admin/api/auth/sso/callback";
      installWebClient(
        keycloak,
        ISSUER,
        guideClient({ redirectUris: [httpCallback] }),
      );
      const body = checkBody({ apps: [checkBody().apps[0]] });
      body.apps[0].redirectUris = [httpCallback];

      const rows = await check(body);

      expect(rows[4].parts).to.deep.equal([
        { label: httpCallback, status: "ok", reason: "redirect_uri_accepted" },
      ]);
      expect(authorizeProbesFor(httpCallback).length).to.be.at.least(1);
    });

    const ANY_ERROR = [
      ["Standard flow is off", { standardFlow: false }],
      ["PKCE plain is required", { pkce: "plain" }],
      ["no PKCE is required", { pkce: null }],
    ];
    for (const [what, client] of ANY_ERROR) {
      it(`is met while ${what}: Keycloak sends the probe back with any error`, async function () {
        installWebClient(keycloak, ISSUER, guideClient(client));

        const rows = await check();

        expect(rows[4].status).to.equal("ok");
        expect(rows[4].parts.map((part) => part.reason)).to.deep.equal([
          "redirect_uri_accepted",
          "redirect_uri_accepted",
        ]);
      });
    }

    it("is not checkable for an unknown or disabled Web-Client, without probing", async function () {
      installWebClient(keycloak, ISSUER, guideClient({ client: "disabled" }));

      const rows = await check();

      expect(rows[4]).to.deep.equal({
        id: 4,
        status: "na",
        reason: "web_client_invalid",
        parts: [
          { label: ADMIN_CALLBACK, status: "na", reason: "web_client_invalid" },
          {
            label: PORTAL_CALLBACK,
            status: "na",
            reason: "web_client_invalid",
          },
        ],
      });
      expect(requestsTo("GET", "auth")).to.deep.equal([]);
    });

    const UNEXPECTED = [
      [
        "a redirect elsewhere",
        (req) =>
          redirect(
            `https://login.example.test/realms/city/broker?error=x&state=${req.query.state}`,
          ),
        {
          httpStatus: 302,
          error: "x",
          location: "https://login.example.test/realms/city/broker",
        },
      ],
      [
        "a redirect to the URI without an error",
        (req) => redirect(`${req.query.redirect_uri}?state=${req.query.state}`),
        { httpStatus: 302, location: ADMIN_CALLBACK },
      ],
      [
        "a redirect to a longer path",
        (req) =>
          redirect(`${req.query.redirect_uri}/more?error=login_required`),
        {
          httpStatus: 302,
          error: "login_required",
          location: `${ADMIN_CALLBACK}/more`,
        },
      ],
      [
        "a server error",
        () => json(500, { error: "unknown_error" }),
        { httpStatus: 500, error: "unknown_error" },
      ],
      ["a page with another status", () => html(200), { httpStatus: 200 }],
    ];
    for (const [what, answer, details] of UNEXPECTED) {
      it(`is not checkable for ${what}, with what Keycloak answered`, async function () {
        const client = installWebClient(keycloak, ISSUER, guideClient());
        keycloak.on("GET", `${OIDC}/auth`, (req) =>
          req.query.redirect_uri === ADMIN_CALLBACK
            ? answer(req)
            : client.authorize(req),
        );

        const rows = await check();

        expect(partOf(rows[4], ADMIN_CALLBACK)).to.deep.equal({
          label: ADMIN_CALLBACK,
          status: "na",
          reason: "unexpected_response",
          details,
        });
      });
    }

    it("is not checkable when the http variant gets an answer it does not know", async function () {
      const client = installWebClient(keycloak, ISSUER, guideClient());
      keycloak.on("GET", `${OIDC}/auth`, (req) =>
        req.query.redirect_uri.startsWith("http:")
          ? timeout()
          : client.authorize(req),
      );

      const rows = await check();

      expect(partOf(rows[4], ADMIN_CALLBACK)).to.deep.equal({
        label: ADMIN_CALLBACK,
        status: "na",
        reason: "timeout",
        details: { url: `${OIDC}/auth` },
      });
    });

    it("has no row 4 when the body names no redirect URI", async function () {
      installWebClient(keycloak, ISSUER, guideClient());

      const rows = await check({ mode: "bff", apps: [] });

      expect(rows).not.to.have.property("4");
      expect(requestsTo("GET", "auth")).to.deep.equal([]);
    });
  });

  describe("row 5, Valid Post Logout Redirect URIs", function () {
    /** The logout probes for one post logout redirect URI. */
    const logoutProbesFor = (uri) =>
      requestsTo("GET", "logout").filter(
        (r) => r.query.post_logout_redirect_uri === uri,
      );

    it("is met when Keycloak redirects to every entry, an entry with * probed with a sample query under its label as sent", async function () {
      installWebClient(keycloak, ISSUER, guideClient());

      const rows = await check();

      expect(rows[5]).to.deep.equal({
        id: 5,
        status: "ok",
        reason: "post_logout_redirect_accepted",
        parts: [ADMIN_LOGIN, ADMIN_SWITCH, PORTAL_SWITCH].map((label) => ({
          label,
          status: "ok",
          reason: "post_logout_redirect_accepted",
        })),
      });
      const [probe] = logoutProbesFor(
        `${ADMIN_ORIGIN}/admin/api/auth/sso/login?redirect=%2F`,
      );
      expect(probe.query).to.have.keys(
        "client_id",
        "post_logout_redirect_uri",
        "state",
      );
      expect(probe.query.client_id).to.equal(WEB_CLIENT);
      expect(probe.query.state).to.match(/^[A-Za-z0-9_-]{43}$/);
      expect(probe.headers).not.to.have.property("cookie");
      expect(probe.headers).not.to.have.property("origin");
      expect(logoutProbesFor(ADMIN_LOGIN)).to.have.length(1);
    });

    it("is not met for a missing entry, and for an entry the realm lists without its *", async function () {
      installWebClient(
        keycloak,
        ISSUER,
        guideClient({
          postLogoutRedirectUris: [
            ADMIN_LOGIN,
            `${ADMIN_ORIGIN}/admin/api/auth/sso/login`,
          ],
        }),
      );

      const rows = await check();

      expect(rows[5].status).to.equal("fail");
      expect(rows[5].reason).to.equal("post_logout_redirect_rejected");
      expect(rows[5].parts).to.deep.equal([
        {
          label: ADMIN_LOGIN,
          status: "ok",
          reason: "post_logout_redirect_accepted",
        },
        ...[ADMIN_SWITCH, PORTAL_SWITCH].map((label) => ({
          label,
          status: "fail",
          reason: "post_logout_redirect_rejected",
          details: { httpStatus: 400 },
        })),
      ]);
    });

    it("is met for any redirect to the entry, also a 303", async function () {
      const client = installWebClient(keycloak, ISSUER, guideClient());
      keycloak.on("GET", `${OIDC}/logout`, (req) => {
        const answer = client.logout(req);
        return answer.status === 302
          ? redirect(answer.headers.location, 303)
          : answer;
      });

      const rows = await check();

      expect(rows[5].status).to.equal("ok");
    });

    for (const client of ["unknown", "disabled"]) {
      it(`is not checkable for a Web-Client that is ${client}, without probing`, async function () {
        installWebClient(keycloak, ISSUER, guideClient({ client }));

        const rows = await check();

        expect(rows[5]).to.deep.equal({
          id: 5,
          status: "na",
          reason: "web_client_invalid",
          parts: [ADMIN_LOGIN, ADMIN_SWITCH, PORTAL_SWITCH].map((label) => ({
            label,
            status: "na",
            reason: "web_client_invalid",
          })),
        });
        expect(requestsTo("GET", "logout")).to.deep.equal([]);
      });
    }

    const UNEXPECTED = [
      ["a confirmation page", () => html(200), { httpStatus: 200 }],
      [
        "a redirect elsewhere",
        () => redirect(`${ADMIN_ORIGIN}/admin/loginx?state=s`),
        { httpStatus: 302, location: `${ADMIN_ORIGIN}/admin/loginx` },
      ],
      [
        "a redirect without a Location",
        () => ({ status: 302, headers: {}, body: "" }),
        { httpStatus: 302 },
      ],
      [
        "an answer with a JSON error",
        () => json(401, { error: "invalid_token" }),
        { httpStatus: 401, error: "invalid_token" },
      ],
    ];
    for (const [what, answer, details] of UNEXPECTED) {
      it(`is not checkable for ${what}, with what Keycloak answered`, async function () {
        const client = installWebClient(keycloak, ISSUER, guideClient());
        keycloak.on("GET", `${OIDC}/logout`, (req) =>
          req.query.post_logout_redirect_uri === ADMIN_LOGIN
            ? answer(req)
            : client.logout(req),
        );

        const rows = await check();

        expect(partOf(rows[5], ADMIN_LOGIN)).to.deep.equal({
          label: ADMIN_LOGIN,
          status: "na",
          reason: "unexpected_response",
          details,
        });
      });
    }

    it("has no row 5 when the body names no post logout redirect URI", async function () {
      installWebClient(keycloak, ISSUER, guideClient());
      const body = checkBody();
      body.apps.forEach((app) => (app.postLogoutRedirectUris = []));

      const rows = await check(body);

      expect(rows).not.to.have.property("5");
      expect(requestsTo("GET", "logout")).to.deep.equal([]);
    });
  });

  describe("row 6, Web Origins", function () {
    /** The token probes that carry an Origin. */
    const originProbes = () =>
      requestsTo("POST", "token").filter((r) => r.headers.origin);

    it("is met in direct mode when Keycloak allows the Admin UI's origin with a dummy refresh token", async function () {
      installWebClient(keycloak, ISSUER, guideClient());

      const rows = await check(checkBody({ mode: "direct" }));

      expect(rows[6]).to.deep.equal({
        id: 6,
        status: "ok",
        reason: "origin_allowed",
        parts: [
          { label: ADMIN_ORIGIN, status: "ok", reason: "origin_allowed" },
        ],
      });
      const [probe] = originProbes();
      expect(probe.headers.origin).to.equal(ADMIN_ORIGIN);
      expect(probe.form).to.deep.equal({
        grant_type: "refresh_token",
        client_id: WEB_CLIENT,
        refresh_token: "x",
      });
      expect(originProbes()).to.have.length(1);
    });

    it("probes every origin of the Admin UI, never the Storefront's", async function () {
      const second = "https://admin.example.test";
      installWebClient(keycloak, ISSUER, guideClient());
      const body = checkBody({ mode: "direct" });
      body.apps.push({
        ...body.apps[0],
        origin: second,
        redirectUris: [],
        postLogoutRedirectUris: [],
      });

      const rows = await check(body);

      expect(rows[6].parts).to.deep.equal([
        { label: ADMIN_ORIGIN, status: "ok", reason: "origin_allowed" },
        {
          label: second,
          status: "fail",
          reason: "origin_not_allowed",
          details: { httpStatus: 403 },
        },
      ]);
      expect(rows[6].reason).to.equal("origin_not_allowed");
      expect(originProbes().map((r) => r.headers.origin)).to.have.members([
        ADMIN_ORIGIN,
        second,
      ]);
    });

    it("is not met for an origin Keycloak answers with 400 but without its header", async function () {
      const client = installWebClient(keycloak, ISSUER, guideClient());
      keycloak.on("POST", `${OIDC}/token`, (req) =>
        req.headers.origin
          ? json(400, { error: "invalid_grant" })
          : client.token(req),
      );

      const rows = await check(checkBody({ mode: "direct" }));

      expect(rows[6].parts).to.deep.equal([
        {
          label: ADMIN_ORIGIN,
          status: "fail",
          reason: "origin_not_allowed",
          details: { httpStatus: 400 },
        },
      ]);
    });

    it("is not met for an origin Keycloak answers with another origin's header", async function () {
      const client = installWebClient(keycloak, ISSUER, guideClient());
      keycloak.on("POST", `${OIDC}/token`, (req) =>
        req.headers.origin
          ? json(
              400,
              { error: "invalid_grant" },
              { "access-control-allow-origin": PORTAL_ORIGIN },
            )
          : client.token(req),
      );

      const rows = await check(checkBody({ mode: "direct" }));

      expect(rows[6].status).to.equal("fail");
      expect(rows[6].reason).to.equal("origin_not_allowed");
    });

    const NOT_PUBLIC = [
      ["with Client authentication on", "confidential"],
      ["unknown", "unknown"],
      ["disabled", "disabled"],
    ];
    for (const [what, client] of NOT_PUBLIC) {
      it(`is not checkable for a Web-Client ${what}, which gets every origin echoed, without probing`, async function () {
        installWebClient(keycloak, ISSUER, guideClient({ client }));

        const rows = await check(checkBody({ mode: "direct" }));

        expect(rows[6]).to.deep.equal({
          id: 6,
          status: "na",
          reason: "web_client_invalid",
          parts: [
            { label: ADMIN_ORIGIN, status: "na", reason: "web_client_invalid" },
          ],
        });
        expect(originProbes()).to.deep.equal([]);
      });
    }

    it("is not checkable while the token part of row 2 is not checkable", async function () {
      const client = installWebClient(keycloak, ISSUER, guideClient());
      keycloak.on("POST", `${OIDC}/token`, (req) =>
        req.form.grant_type === "authorization_code"
          ? json(500, { error: "unknown_error" })
          : client.token(req),
      );

      const rows = await check(checkBody({ mode: "direct" }));

      expect(rows[6].reason).to.equal("web_client_invalid");
      expect(originProbes()).to.deep.equal([]);
    });

    it("is not checkable when Keycloak refuses the client at the origin probe, with its status and error", async function () {
      const client = installWebClient(keycloak, ISSUER, guideClient());
      keycloak.on("POST", `${OIDC}/token`, (req) =>
        req.headers.origin
          ? json(
              401,
              { error: "unauthorized_client" },
              { "access-control-allow-origin": req.headers.origin },
            )
          : client.token(req),
      );

      const rows = await check(checkBody({ mode: "direct" }));

      expect(rows[6].parts).to.deep.equal([
        {
          label: ADMIN_ORIGIN,
          status: "na",
          reason: "web_client_invalid",
          details: { httpStatus: 401, error: "unauthorized_client" },
        },
      ]);
    });

    it("is not checkable for an answer it does not know", async function () {
      const client = installWebClient(keycloak, ISSUER, guideClient());
      keycloak.on("POST", `${OIDC}/token`, (req) =>
        req.headers.origin ? html(502) : client.token(req),
      );

      const rows = await check(checkBody({ mode: "direct" }));

      expect(rows[6].parts).to.deep.equal([
        {
          label: ADMIN_ORIGIN,
          status: "na",
          reason: "unexpected_response",
          details: { httpStatus: 502 },
        },
      ]);
    });

    it("has no row 6 in BFF mode and sends no Origin", async function () {
      installWebClient(keycloak, ISSUER, guideClient());

      const rows = await check(checkBody({ mode: "bff" }));

      expect(rows).not.to.have.property("6");
      expect(originProbes()).to.deep.equal([]);
    });
  });
});
