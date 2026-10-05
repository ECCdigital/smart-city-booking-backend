/**
 * „Realm prüfen“, row 10, Portal-URL (ECCdigital/tickets#101): the
 * Storefront under the stored Portal-URL sends its SSO sign-in to the stored
 * realm with the Storefront's callback as `redirect_uri`. Over the lifecycle
 * harness with Keycloak and the Storefront faked per method and URL at the
 * HTTP client (`helpers/fake-keycloak-http.js`), answering the way the
 * Storefront's `server/api/auth/sso/login.get.ts` does.
 */

const http = require("http");
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
  redirect,
  timeout,
  unreachable,
  discoveryDocument,
} = require("./helpers/fake-keycloak-http");
const {
  installRealm,
  storefrontRedirect,
} = require("./helpers/fake-keycloak-realm");

const SERVER_URL = "https://idp.example.test";
const ISSUER = `${SERVER_URL}/realms/city`;
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const AUTHORIZE = `${ISSUER}/protocol/openid-connect/auth`;

const PORTAL_URL = "https://portal.example.test";
const SSO_LOGIN = `${PORTAL_URL}/api/auth/sso/login`;
const CALLBACK = `${PORTAL_URL}/api/auth/sso/callback`;

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

/** The storefront entry of the body, as the Admin UI builds it. */
function storefrontEntry(overrides = {}) {
  return {
    app: "storefront",
    origin: PORTAL_URL,
    redirectUris: [CALLBACK],
    postLogoutRedirectUris: [`${PORTAL_URL}/api/auth/sso/login*`],
    ...overrides,
  };
}

/** A request body as the Admin UI sends it in BFF mode. */
function checkBody(storefront = storefrontEntry()) {
  return {
    mode: "bff",
    apps: [
      {
        app: "adminUi",
        origin: "https://booking.example.test",
        redirectUris: [
          "https://booking.example.test/admin/api/auth/sso/callback",
        ],
        postLogoutRedirectUris: ["https://booking.example.test/admin/login"],
      },
      ...(storefront ? [storefront] : []),
    ],
  };
}

describe("POST /api/instances/keycloak/check, row 10, Portal-URL", function () {
  this.timeout(20000);

  let h;
  let fake;

  beforeEach(async function () {
    h = await installHarness({
      instance: { applications: [keycloakApp()], portalUrl: PORTAL_URL },
    });
    fake = new FakeKeycloakHttp().install();
    // Every row runs, against a realm and a Storefront that pass them.
    installRealm(fake, ISSUER, {
      apps: checkBody().apps,
      portalUrl: PORTAL_URL,
    });
  });

  afterEach(async function () {
    sinon.restore();
    KeycloakVerifier.clearCache();
    await h.close();
    fake.verify();
  });

  /** The requests to anything but the stored realm. */
  const outsideRealm = () =>
    fake.requests.filter((r) => !r.path.startsWith(`${ISSUER}/`));

  /** Row 10 of a check with `body`. */
  async function portalRow(body = checkBody()) {
    const res = await h
      .api()
      .post("/api/instances/keycloak/check")
      .set(h.as(ADMIN))
      .send(body);
    expect(res.status).to.equal(200);
    return res.body.rows.find((row) => row.id === 10);
  }

  it("is met when the Storefront sends its sign-in to the stored realm with the callback of the body", async function () {
    fake.on("GET", SSO_LOGIN, storefrontRedirect(CALLBACK, AUTHORIZE));

    expect(await portalRow()).to.deep.equal({
      id: 10,
      status: "ok",
      reason: "storefront_redirect_matches",
      details: { expected: CALLBACK, actual: CALLBACK },
    });
  });

  it("is not met when the Storefront names another origin, with both values", async function () {
    const actual = "http://storefront:3000/api/auth/sso/callback";
    fake.on("GET", SSO_LOGIN, storefrontRedirect(actual, AUTHORIZE));

    expect(await portalRow()).to.deep.equal({
      id: 10,
      status: "fail",
      reason: "storefront_origin_mismatch",
      details: { expected: CALLBACK, actual },
    });
  });

  it("is not checkable when the Storefront names the same origin with another path: a Biletado bug, not the realm", async function () {
    const actual = `${PORTAL_URL}/api/auth/callback`;
    fake.on("GET", SSO_LOGIN, storefrontRedirect(actual, AUTHORIZE));

    expect(await portalRow()).to.deep.equal({
      id: 10,
      status: "na",
      reason: "storefront_path_mismatch",
      details: { expected: CALLBACK, actual },
    });
  });

  it("is not checkable when the Storefront adds a query to its callback", async function () {
    const actual = `${CALLBACK}?locale=de`;
    fake.on("GET", SSO_LOGIN, storefrontRedirect(actual, AUTHORIZE));

    expect(await portalRow()).to.deep.equal({
      id: 10,
      status: "na",
      reason: "storefront_path_mismatch",
      details: { expected: CALLBACK, actual },
    });
  });

  it("is not checkable while the realm is unavailable, and asks no Storefront", async function () {
    fake.on("GET", DISCOVERY, json(404, { error: "Realm does not exist" }));

    expect(await portalRow()).to.deep.equal({
      id: 10,
      status: "na",
      reason: "realm_unavailable",
    });
    expect(fake.requests.map((r) => r.url)).to.deep.equal([DISCOVERY]);
  });

  describe("what the row touches", function () {
    it("asks the Storefront only at the origin of the stored Portal-URL, never at the body's, without an Origin", async function () {
      h.instance.portalUrl = `${PORTAL_URL}/de/start?x=1`;
      const bodyCallback = "http://169.254.169.254/api/auth/sso/callback";
      fake.on("GET", SSO_LOGIN, storefrontRedirect(CALLBACK, AUTHORIZE));

      const row = await portalRow(
        checkBody(
          storefrontEntry({
            origin: "http://169.254.169.254",
            redirectUris: [bodyCallback],
          }),
        ),
      );

      expect(row).to.deep.equal({
        id: 10,
        status: "fail",
        reason: "storefront_origin_mismatch",
        details: { expected: bodyCallback, actual: CALLBACK },
      });
      expect(fake.requests[0].url).to.equal(DISCOVERY);
      expect(outsideRealm().map((r) => r.url)).to.deep.equal([SSO_LOGIN]);
      fake.requests.forEach((r) => {
        expect(r.headers, r.url).not.to.have.property("origin");
      });
    });
  });

  describe("without a redirect to the stored realm", function () {
    it("is not checkable while the Storefront does not know Keycloak yet, with the status", async function () {
      fake.on(
        "GET",
        SSO_LOGIN,
        json(503, {
          url: "/api/auth/sso/login",
          statusCode: 503,
          statusMessage: "Keycloak SSO is not configured or inactive",
          message: "Keycloak SSO is not configured or inactive",
        }),
      );

      expect(await portalRow()).to.deep.equal({
        id: 10,
        status: "na",
        reason: "storefront_not_redirecting",
        details: { httpStatus: 503 },
      });
    });

    it("is not checkable for a redirect to an error page, with origin and path of its target", async function () {
      fake.on(
        "GET",
        SSO_LOGIN,
        redirect("/error?message=sso%20failed&redirect_uri=x"),
      );

      expect(await portalRow()).to.deep.equal({
        id: 10,
        status: "na",
        reason: "storefront_not_redirecting",
        details: { httpStatus: 302, location: `${PORTAL_URL}/error` },
      });
    });

    it("is not checkable for a redirect to another realm", async function () {
      const elsewhere = `${SERVER_URL}/realms/town/protocol/openid-connect/auth`;
      fake.on("GET", SSO_LOGIN, storefrontRedirect(CALLBACK, elsewhere));

      expect(await portalRow()).to.deep.equal({
        id: 10,
        status: "na",
        reason: "storefront_not_redirecting",
        details: { httpStatus: 302, location: elsewhere },
      });
    });

    it("is not checkable for a redirect to the stored realm without a redirect_uri", async function () {
      fake.on(
        "GET",
        SSO_LOGIN,
        redirect(`${AUTHORIZE}?client_id=booking-client&response_type=code`),
      );

      expect(await portalRow()).to.deep.equal({
        id: 10,
        status: "na",
        reason: "storefront_not_redirecting",
        details: { httpStatus: 302, location: AUTHORIZE },
      });
    });
  });

  describe("without an answer", function () {
    it("is not checkable when the Storefront does not answer in time", async function () {
      fake.on("GET", SSO_LOGIN, timeout());

      expect(await portalRow()).to.deep.equal({
        id: 10,
        status: "na",
        reason: "timeout",
        details: { url: SSO_LOGIN },
      });
    });

    it("is not checkable when the Storefront cannot be reached, with the error code", async function () {
      fake.on("GET", SSO_LOGIN, unreachable("ENOTFOUND"));

      expect(await portalRow()).to.deep.equal({
        id: 10,
        status: "na",
        reason: "unreachable",
        details: { url: SSO_LOGIN, code: "ENOTFOUND" },
      });
    });
  });

  describe("without anything to compare", function () {
    it("is not checkable without a stored Portal-URL, and asks no Storefront", async function () {
      h.instance.portalUrl = "";

      expect(await portalRow()).to.deep.equal({
        id: 10,
        status: "na",
        reason: "portal_url_missing",
      });
      expect(outsideRealm()).to.deep.equal([]);
    });

    it("is not checkable with an emptied Portal-URL, never falling back to the legacy catalogUrl", async function () {
      h.instance.portalUrl = "";
      h.instance.catalogUrl = PORTAL_URL;

      expect(await portalRow()).to.deep.equal({
        id: 10,
        status: "na",
        reason: "portal_url_missing",
      });
      expect(outsideRealm()).to.deep.equal([]);
    });

    it("asks the Storefront under the legacy catalogUrl where no Portal-URL was ever stored", async function () {
      delete h.instance.portalUrl;
      h.instance.catalogUrl = PORTAL_URL;

      expect((await portalRow()).reason).to.equal(
        "storefront_redirect_matches",
      );
      expect(outsideRealm().map((r) => r.url)).to.deep.equal([SSO_LOGIN]);
    });

    it("is not checkable with a stored Portal-URL that is no absolute http(s) address, and asks no Storefront", async function () {
      h.instance.portalUrl = "portal.example.test";

      expect(await portalRow()).to.deep.equal({
        id: 10,
        status: "na",
        reason: "portal_url_missing",
      });
      expect(outsideRealm()).to.deep.equal([]);
    });

    it("is not checkable without a storefront entry in the body, and asks no Storefront", async function () {
      expect(await portalRow(checkBody(null))).to.deep.equal({
        id: 10,
        status: "na",
        reason: "portal_url_missing",
      });
      expect(outsideRealm()).to.deep.equal([]);
    });
  });
});

describe("POST /api/instances/keycloak/check, row 10, over a real connection", function () {
  this.timeout(20000);

  let h;
  let server;
  /** The paths the server was asked for, in order. */
  let hits;
  /** Path and query of the Storefront's redirect to Keycloak. */
  let redirectTarget;
  let baseUrl;

  beforeEach(async function () {
    hits = [];
    // Keycloak and the Storefront on one address: the discovery, and the
    // Storefront's sign-in with its redirect and short-lived cookies.
    server = http.createServer((req, res) => {
      hits.push(req.url);
      if (req.url === "/realms/city/.well-known/openid-configuration") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify(discoveryDocument(`${baseUrl}/realms/city`)),
        );
      }
      if (req.url === "/api/auth/sso/login") {
        const answer = storefrontRedirect(
          `${baseUrl}/api/auth/sso/callback`,
          `${baseUrl}/realms/city/protocol/openid-connect/auth`,
        );
        const target = new URL(answer.headers.location);
        redirectTarget = `${target.pathname}${target.search}`;
        res.writeHead(302, {
          Location: answer.headers.location,
          "Set-Cookie": [
            "kc-code-verifier=v; Max-Age=300; Path=/; HttpOnly; SameSite=Lax",
            "kc-state=s; Max-Age=300; Path=/; HttpOnly; SameSite=Lax",
          ],
        });
        return res.end();
      }
      res.writeHead(404);
      return res.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    h = await installHarness({
      instance: {
        applications: [keycloakApp({ serverUrl: baseUrl })],
        portalUrl: baseUrl,
      },
    });
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
    await new Promise((resolve) => server.close(resolve));
  });

  it("does not follow the Storefront's redirect to Keycloak", async function () {
    const callback = `${baseUrl}/api/auth/sso/callback`;

    const res = await h
      .api()
      .post("/api/instances/keycloak/check")
      .set(h.as(ADMIN))
      .send(
        checkBody(
          storefrontEntry({ origin: baseUrl, redirectUris: [callback] }),
        ),
      );

    expect(res.status).to.equal(200);
    expect(res.body.rows.find((row) => row.id === 10)).to.deep.equal({
      id: 10,
      status: "ok",
      reason: "storefront_redirect_matches",
      details: { expected: callback, actual: callback },
    });
    // Keycloak shares the address, so the other rows' probes reach it too;
    // but nothing comes after the Storefront's sign-in (row 10 runs last),
    // and its redirect target is never asked for.
    expect(hits[0]).to.equal("/realms/city/.well-known/openid-configuration");
    expect(hits.slice(hits.indexOf("/api/auth/sso/login"))).to.deep.equal([
      "/api/auth/sso/login",
    ]);
    expect(hits).not.to.include(redirectTarget);
  });
});
