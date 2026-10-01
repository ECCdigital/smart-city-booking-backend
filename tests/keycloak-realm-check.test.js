/**
 * „Realm prüfen“ (ECCdigital/tickets#97): `POST /api/instances/keycloak/check`
 * checks the stored realm from outside, over the lifecycle harness with
 * Keycloak faked per method and URL at the HTTP client
 * (`helpers/fake-keycloak-http.js`). The contract of the request, the rows
 * and the reasons is the one the Admin UI reads.
 */

const http = require("http");
const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  ADMIN,
  OWNER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const KeycloakVerifier = require("../src/commons/utilities/keycloak-verifier");
const {
  FakeKeycloakHttp,
  json,
  html,
  redirect,
  timeout,
  unreachable,
  discoveryDocument,
} = require("./helpers/fake-keycloak-http");
const { installWebClient } = require("./helpers/fake-keycloak-web-client");

const SERVER_URL = "https://idp.example.test";
const ISSUER = `${SERVER_URL}/realms/city`;
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;

/** The stored Keycloak application of the instance. */
function keycloakApp(overrides = {}) {
  return {
    type: "auth",
    id: "keycloak",
    active: true,
    serverUrl: SERVER_URL,
    realm: "city",
    publicClient: "booking-client",
    privateClient: "backend",
    privateClientSecret: "secret",
    roleMapping: { active: false, roles: [] },
    ...overrides,
  };
}

/** A request body as the Admin UI sends it in BFF mode. */
function checkBody(overrides = {}) {
  return {
    mode: "bff",
    apps: [
      {
        app: "adminUi",
        origin: "https://booking.example.test",
        redirectUris: [
          "https://booking.example.test/admin/api/auth/sso/callback",
        ],
        postLogoutRedirectUris: [
          "https://booking.example.test/admin/login",
          "https://booking.example.test/admin/api/auth/sso/login*",
        ],
      },
      {
        app: "storefront",
        origin: "https://portal.example.test",
        redirectUris: ["https://portal.example.test/api/auth/sso/callback"],
        postLogoutRedirectUris: [
          "https://portal.example.test/api/auth/sso/login*",
        ],
      },
    ],
    ...overrides,
  };
}

describe("POST /api/instances/keycloak/check", function () {
  this.timeout(20000);

  let h;
  let keycloak;

  beforeEach(async function () {
    h = await installHarness({ instance: { applications: [keycloakApp()] } });
    keycloak = new FakeKeycloakHttp().install();
    installWebClient(keycloak, ISSUER);
  });

  afterEach(async function () {
    sinon.restore();
    KeycloakVerifier.clearCache();
    await h.close();
    keycloak.verify();
  });

  const check = (body = checkBody(), userId = ADMIN) => {
    let req = h.api().post("/api/instances/keycloak/check");
    if (userId) req = req.set(h.as(userId));
    return req.send(body);
  };

  describe("rights", function () {
    it("lets the instance owner check and refuses everyone else before any probe", async function () {
      keycloak.on("GET", DISCOVERY, json(200, discoveryDocument(ISSUER)));

      expect((await check(checkBody(), null)).status).to.equal(401);
      const customer = await check(checkBody(), CUSTOMER);
      expect(customer.status).to.equal(403);
      expect(customer.body).to.deep.equal({
        error: "ForbiddenError",
        code: "forbidden",
        statusCode: 403,
        params: {},
      });
      expect((await check(checkBody(), OWNER)).status).to.equal(403);
      expect(keycloak.requests).to.deep.equal([]);

      expect((await check(checkBody(), ADMIN)).status).to.equal(200);
    });
  });

  describe("the request body", function () {
    it("refuses a body without mode and apps in the validation form, before any probe", async function () {
      const res = await check({ id: "x", tenantId: "tenant-1" });

      expect(res.status).to.equal(400);
      expect(res.body).to.deep.equal({
        error: "ValidationError",
        message: "validation_failed",
        statusCode: 400,
        details: [
          { field: "mode", code: "required" },
          { field: "apps", code: "required" },
        ],
      });
      expect(keycloak.requests).to.deep.equal([]);
    });

    /** The body with its admin UI entry (`apps[0]`) changed. */
    const withAdminUi = (changes) => {
      const body = checkBody();
      Object.assign(body.apps[0], changes);
      return body;
    };
    const CALLBACK = "https://booking.example.test/admin/api/auth/sso/callback";
    const eleven = (value) => Array.from({ length: 11 }, () => value);

    const REFUSED = [
      [
        "a mode other than bff and direct",
        checkBody({ mode: "implicit" }),
        {
          field: "mode",
          code: "invalid_enum",
          params: { allowed: ["bff", "direct"] },
        },
      ],
      [
        "apps that are no list",
        checkBody({ apps: { app: "adminUi" } }),
        { field: "apps", code: "invalid_type_array" },
      ],
      [
        "more than 10 apps",
        checkBody({ apps: eleven(checkBody().apps[0]) }),
        { field: "apps", code: "max_items", params: { max: 10 } },
      ],
      [
        "an entry that is no object",
        checkBody({ apps: ["adminUi"] }),
        { field: "apps[0]", code: "invalid_format" },
      ],
      [
        "an app other than adminUi and storefront",
        withAdminUi({ app: "bff" }),
        {
          field: "apps[0].app",
          code: "invalid_enum",
          params: { allowed: ["adminUi", "storefront"] },
        },
      ],
      [
        "a second storefront",
        checkBody({ apps: [checkBody().apps[1], checkBody().apps[1]] }),
        {
          field: "apps",
          code: "max_items",
          params: { app: "storefront", max: 1 },
        },
      ],
      [
        "an entry without origin",
        withAdminUi({ origin: undefined }),
        { field: "apps[0].origin", code: "required" },
      ],
      [
        "an origin with a path",
        withAdminUi({ origin: "https://booking.example.test/admin" }),
        { field: "apps[0].origin", code: "invalid_format" },
      ],
      [
        "an origin that is no http(s)",
        withAdminUi({ origin: "ftp://booking.example.test" }),
        { field: "apps[0].origin", code: "invalid_format" },
      ],
      [
        "redirect URIs that are no list",
        withAdminUi({ redirectUris: CALLBACK }),
        { field: "apps[0].redirectUris", code: "invalid_type_array" },
      ],
      [
        "an entry without post logout redirect URIs",
        withAdminUi({ postLogoutRedirectUris: undefined }),
        { field: "apps[0].postLogoutRedirectUris", code: "required" },
      ],
      [
        "a relative redirect URI",
        withAdminUi({ redirectUris: ["/admin/api/auth/sso/callback"] }),
        { field: "apps[0].redirectUris[0]", code: "invalid_format" },
      ],
      [
        "a redirect URI that is no http(s)",
        withAdminUi({ redirectUris: ["javascript:alert(1)"] }),
        { field: "apps[0].redirectUris[0]", code: "invalid_format" },
      ],
      [
        "a redirect URI that is no string",
        withAdminUi({ redirectUris: [42] }),
        { field: "apps[0].redirectUris[0]", code: "invalid_type_string" },
      ],
      [
        "a trailing * on a redirect URI",
        withAdminUi({ redirectUris: [`${CALLBACK}*`] }),
        { field: "apps[0].redirectUris[0]", code: "invalid_format" },
      ],
      [
        "more than 10 redirect URIs",
        withAdminUi({ redirectUris: eleven(CALLBACK) }),
        {
          field: "apps[0].redirectUris",
          code: "max_items",
          params: { max: 10 },
        },
      ],
      [
        "a URI longer than 2048 characters",
        withAdminUi({
          postLogoutRedirectUris: [`${CALLBACK}?${"x".repeat(2048)}`],
        }),
        {
          field: "apps[0].postLogoutRedirectUris[0]",
          code: "max_length",
          params: { max: 2048 },
        },
      ],
    ];

    for (const [what, body, detail] of REFUSED) {
      it(`refuses ${what}`, async function () {
        const res = await check(body);

        expect(res.status).to.equal(400);
        expect(res.body.error).to.equal("ValidationError");
        expect(res.body.details).to.deep.equal([detail]);
      });
    }

    it("accepts direct mode without any app", async function () {
      keycloak.on("GET", DISCOVERY, json(200, discoveryDocument(ISSUER)));

      const res = await check({ mode: "direct", apps: [] });

      expect(res.status).to.equal(200);
    });
  });

  describe("the stored values", function () {
    it("refuses to check without a Keycloak application, naming what is missing", async function () {
      h.instance.applications = [];

      const res = await check();

      expect(res.status).to.equal(400);
      expect(res.body).to.deep.equal({
        error: "BadRequestError",
        code: "keycloak_settings_missing",
        statusCode: 400,
        params: {
          missing: [
            "serverUrl",
            "realm",
            "publicClient",
            "privateClient",
            "privateClientSecret",
          ],
        },
      });
      expect(keycloak.requests).to.deep.equal([]);
    });

    it("refuses to check while a stored value is empty", async function () {
      h.instance.applications = [
        keycloakApp({ realm: "", privateClientSecret: null }),
      ];

      const res = await check();

      expect(res.status).to.equal(400);
      expect(res.body.params).to.deep.equal({
        missing: ["realm", "privateClientSecret"],
      });
      expect(keycloak.requests).to.deep.equal([]);
    });
  });

  describe("what the check touches", function () {
    it("requests only the stored Keycloak-URL, never an address of the body, and sends no Origin", async function () {
      keycloak.on("GET", DISCOVERY, json(200, discoveryDocument(ISSUER)));
      const body = checkBody();
      body.apps[0].origin = "http://169.254.169.254";
      body.apps[0].redirectUris = ["http://169.254.169.254/latest/meta-data"];

      expect((await check(body)).status).to.equal(200);

      expect(keycloak.requests[0].url).to.equal(DISCOVERY);
      keycloak.requests.forEach((r) => {
        expect(r.path.startsWith(`${ISSUER}/`), r.url).to.equal(true);
        expect(r.headers).not.to.have.property("origin");
      });
    });

    it("reads the stored values afresh, not from the token check's cache", async function () {
      keycloak.on("GET", DISCOVERY, json(200, discoveryDocument(ISSUER)));
      KeycloakVerifier.clearCache();
      await KeycloakVerifier.getKeycloakConfig();
      const other = "https://sso.example.test/realms/town";
      h.instance.applications = [
        keycloakApp({ serverUrl: "https://sso.example.test", realm: "town" }),
      ];
      keycloak.on(
        "GET",
        `${other}/.well-known/openid-configuration`,
        json(200, discoveryDocument(other)),
      );
      installWebClient(keycloak, other);

      const res = await check();

      expect(res.body.rows[0].details).to.deep.equal({ issuer: other });
    });

    it("checks a realm while Keycloak is not active yet", async function () {
      h.instance.applications = [keycloakApp({ active: false })];
      keycloak.on("GET", DISCOVERY, json(200, discoveryDocument(ISSUER)));

      const res = await check();

      expect(res.status).to.equal(200);
      expect(res.body.rows[0].status).to.equal("ok");
    });

    it("stores nothing", async function () {
      keycloak.on("GET", DISCOVERY, json(200, discoveryDocument(ISSUER)));
      const writes = [
        sinon.stub(InstanceManager, "updateInstance").rejects(),
        sinon.stub(InstanceManager, "updateBackground").rejects(),
      ];

      expect((await check()).status).to.equal(200);

      writes.forEach((write) => expect(write.called).to.equal(false));
    });
  });

  describe("row 1, realm and issuer", function () {
    it("is met when the discovery names exactly the stored realm as issuer", async function () {
      keycloak.on("GET", DISCOVERY, json(200, discoveryDocument(ISSUER)));

      const res = await check();

      expect(res.status).to.equal(200);
      expect(res.body.rows[0]).to.deep.equal({
        id: 1,
        status: "ok",
        reason: "issuer_matches",
        details: { issuer: ISSUER },
      });
      expect(new Date(res.body.checkedAt).toISOString()).to.equal(
        res.body.checkedAt,
      );
    });

    /** Row 1 of a check whose discovery answers `answer`. */
    async function realmRowFor(answer) {
      keycloak.on("GET", DISCOVERY, answer);
      const res = await check();
      expect(res.status).to.equal(200);
      return res.body.rows[0];
    }

    it("is not met when Keycloak does not know the realm", async function () {
      expect(
        await realmRowFor(json(404, { error: "Realm does not exist" })),
      ).to.deep.equal({
        id: 1,
        status: "fail",
        reason: "realm_not_found",
        details: { httpStatus: 404, url: DISCOVERY },
      });
    });

    it("is not met when the discovery names another issuer, with both values", async function () {
      const other = "https://sso.example.test/realms/city";

      expect(
        await realmRowFor(json(200, discoveryDocument(other))),
      ).to.deep.equal({
        id: 1,
        status: "fail",
        reason: "issuer_mismatch",
        details: { expected: ISSUER, actual: other },
      });
    });

    it("is not checkable for an answer it does not know, with the status and the error", async function () {
      expect(
        await realmRowFor(json(500, { error: "unknown_error" })),
      ).to.deep.equal({
        id: 1,
        status: "na",
        reason: "unexpected_response",
        details: { httpStatus: 500, error: "unknown_error" },
      });
    });

    it("never reads a page: a 200 page is not checkable, whatever its text", async function () {
      expect(await realmRowFor(html(200))).to.deep.equal({
        id: 1,
        status: "na",
        reason: "unexpected_response",
        details: { httpStatus: 200 },
      });
    });

    it("is not checkable without an answer in time", async function () {
      expect(await realmRowFor(timeout())).to.deep.equal({
        id: 1,
        status: "na",
        reason: "timeout",
        details: { url: DISCOVERY },
      });
    });

    it("is not checkable when Keycloak cannot be reached, with the error code", async function () {
      expect(await realmRowFor(unreachable("ENOTFOUND"))).to.deep.equal({
        id: 1,
        status: "na",
        reason: "unreachable",
        details: { url: DISCOVERY, code: "ENOTFOUND" },
      });
    });

    it("follows no redirect: a redirect is the answer, not checkable, with origin and path of its target", async function () {
      const row = await realmRowFor(
        redirect(
          "https://login.example.test/realms/city/.well-known/openid-configuration?error=moved",
        ),
      );

      expect(row).to.deep.equal({
        id: 1,
        status: "na",
        reason: "unexpected_response",
        details: {
          httpStatus: 302,
          error: "moved",
          location:
            "https://login.example.test/realms/city/.well-known/openid-configuration",
        },
      });
      expect(keycloak.requests.map((r) => r.url)).to.deep.equal([DISCOVERY]);
    });
  });
});

describe("POST /api/instances/keycloak/check over a real connection", function () {
  this.timeout(20000);

  let h;
  let server;
  /** The paths the server was asked for, in order. */
  let hits;
  let serverUrl;

  beforeEach(async function () {
    hits = [];
    server = http.createServer((req, res) => {
      hits.push(req.url);
      if (req.url === "/realms/city/.well-known/openid-configuration") {
        res.writeHead(302, { Location: "/realms/city/moved" });
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify(discoveryDocument(`${serverUrl}/realms/city`)),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    serverUrl = `http://127.0.0.1:${server.address().port}`;
    h = await installHarness({
      instance: { applications: [keycloakApp({ serverUrl })] },
    });
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
    await new Promise((resolve) => server.close(resolve));
  });

  it("does not follow Keycloak's redirect", async function () {
    const res = await h
      .api()
      .post("/api/instances/keycloak/check")
      .set(h.as(ADMIN))
      .send(checkBody());

    expect(res.status).to.equal(200);
    expect(res.body.rows[0]).to.deep.equal({
      id: 1,
      status: "na",
      reason: "unexpected_response",
      details: {
        httpStatus: 302,
        location: `${serverUrl}/realms/city/moved`,
      },
    });
    expect(hits).to.deep.equal([
      "/realms/city/.well-known/openid-configuration",
    ]);
  });

  it("names a refused connection", async function () {
    await new Promise((resolve) => server.close(resolve));
    server = { close: (done) => done() };

    const res = await h
      .api()
      .post("/api/instances/keycloak/check")
      .set(h.as(ADMIN))
      .send(checkBody());

    expect(res.body.rows[0]).to.deep.equal({
      id: 1,
      status: "na",
      reason: "unreachable",
      details: {
        url: `${serverUrl}/realms/city/.well-known/openid-configuration`,
        code: "ECONNREFUSED",
      },
    });
  });
});
