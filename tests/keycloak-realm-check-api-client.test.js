/**
 * „Realm prüfen“ (ECCdigital/tickets#100), rows 7 to 9 of
 * `POST /api/instances/keycloak/check`: the API client may introspect
 * (row 7), the web client's tokens carry the API client in `aud` (row 8,
 * Audience-Mapper) and the client roles arrive in the token (row 9, only
 * with an active role mapping). Over the lifecycle harness with Keycloak
 * faked per method and URL (`helpers/fake-keycloak-http.js`); the answers
 * are the ones observed on Keycloak 26.7.3 and 26.8.0 (#103).
 *
 * Rows 8 and 9 read the access token of the request. The harness signs
 * local tokens only (`h.as(userId)`); an SSO sign-in of the instance owner
 * is a Keycloak-shaped token whose verification (signature, session) is the
 * auth middleware's and stubbed here, and whose subject is bound to the
 * owner's account (`ssoAs(claims)`).
 */

const { expect } = require("chai");
const sinon = require("sinon");
const jwt = require("jsonwebtoken");

const {
  installHarness,
  ADMIN,
} = require("./helpers/booking-lifecycle-harness");
const KeycloakVerifier = require("../src/commons/utilities/keycloak-verifier");
const UserManager = require("../src/commons/data-managers/user-manager");
const {
  FakeKeycloakHttp,
  json,
  timeout,
} = require("./helpers/fake-keycloak-http");
const { installRealm } = require("./helpers/fake-keycloak-realm");

const SERVER_URL = "https://idp.example.test";
const ISSUER = `${SERVER_URL}/realms/city`;
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const OIDC = `${ISSUER}/protocol/openid-connect`;
const INTROSPECT = `${OIDC}/token/introspect`;
const TOKEN = `${OIDC}/token`;

/** The web client (PUB) and the API client (CONF) with its secret. */
const WEB_CLIENT = "booking-client";
const API_CLIENT = "backend";
const API_SECRET = "secret";
/** HTTP Basic of the API client, the way Keycloak expects it. */
const API_CLIENT_BASIC = `Basic ${Buffer.from(
  `${API_CLIENT}:${API_SECRET}`,
).toString("base64")}`;

/** The Keycloak subject of the instance owner. */
const OWNER_SUB = "kc-owner";

/**
 * The claims of the web client's access token for the instance owner, as
 * Keycloak issues them for a realm set up as the guide says: one audience
 * is a plain string (observed), the client roles under `resource_access`.
 */
function webClientClaims(overrides = {}) {
  return {
    iss: ISSUER,
    sub: OWNER_SUB,
    typ: "Bearer",
    azp: WEB_CLIENT,
    aud: API_CLIENT,
    email: ADMIN,
    scope: "openid profile email",
    resource_access: { [WEB_CLIENT]: { roles: ["biletado-admin"] } },
    ...overrides,
  };
}

/**
 * The authorization header of the instance owner signed in via SSO with a
 * token of `claims` (see the stubs in `beforeEach`).
 */
function ssoAs(claims) {
  return { Authorization: `Bearer ${jwt.sign(claims, "not-checked-here")}` };
}

/** The stored Keycloak application of the instance. */
function keycloakApp(overrides = {}) {
  return {
    type: "auth",
    id: "keycloak",
    active: true,
    serverUrl: SERVER_URL,
    realm: "city",
    publicClient: WEB_CLIENT,
    privateClient: API_CLIENT,
    privateClientSecret: API_SECRET,
    roleMapping: { active: false, roles: [] },
    ...overrides,
  };
}

/** A request body as the Admin UI sends it in BFF mode. */
function checkBody() {
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
    ],
  };
}

describe("POST /api/instances/keycloak/check, API client, audience and client roles", function () {
  this.timeout(20000);

  let h;
  let keycloak;
  /** The realm's answers, to wrap. */
  let realm;

  beforeEach(async function () {
    h = await installHarness({ instance: { applications: [keycloakApp()] } });
    keycloak = new FakeKeycloakHttp().install();
    // Every row runs, against a realm that passes them; each test puts the
    // API client's answers on the wire over the realm's.
    realm = installRealm(keycloak, ISSUER, { apps: checkBody().apps });
    // An SSO sign-in of the instance owner: the auth middleware's
    // verification of a Keycloak token (signature, issuer, session) hands
    // out its claims, and the owner's account is bound to the subject.
    sinon
      .stub(KeycloakVerifier, "verifyToken")
      .callsFake(async (token) => jwt.decode(token));
    sinon
      .stub(UserManager, "getUserBy")
      .callsFake(async ({ keycloakId }) =>
        keycloakId === OWNER_SUB ? { id: ADMIN, keycloakId } : null,
      );
  });

  afterEach(async function () {
    sinon.restore();
    KeycloakVerifier.clearCache();
    await h.close();
    keycloak.verify();
  });

  /** Checks as the instance owner, signed in locally unless told. */
  async function check(signIn = h.as(ADMIN)) {
    const res = await h
      .api()
      .post("/api/instances/keycloak/check")
      .set(signIn)
      .send(checkBody());
    expect(res.status, res.text).to.equal(200);
    return res;
  }

  /** One row of the answer, `undefined` when absent. */
  const rowOf = (res, id) => res.body.rows.find((row) => row.id === id);

  /** The requests the fake answered for one URL. */
  const requestsTo = (url) => keycloak.requests.filter((r) => r.path === url);

  /** Whether a request to the token endpoint is row 7's follow-up. */
  const isFollowUp = (r) => r.form.grant_type === "client_credentials";

  /** Row 7's follow-up probes: client credentials grants. */
  const followUps = () => requestsTo(TOKEN).filter(isFollowUp);

  /**
   * The token endpoint answering row 7's follow-up with `followUp`, and the
   * Web-Client's probes (rows 2 and 6) as the realm does.
   */
  function followUpAnswering(followUp) {
    keycloak.on("POST", TOKEN, (req) =>
      isFollowUp(req) ? followUp : realm.token(req),
    );
  }

  describe("row 7, the API client may introspect", function () {
    it("is met when the introspection with the API client's secret answers a dummy token inactive", async function () {
      keycloak.on("POST", INTROSPECT, json(200, { active: false }));

      const res = await check();

      expect(rowOf(res, 7)).to.deep.equal({
        id: 7,
        status: "ok",
        reason: "introspection_allowed",
      });
      const [introspection] = requestsTo(INTROSPECT);
      expect(introspection.headers.authorization).to.equal(API_CLIENT_BASIC);
      expect(introspection.form).to.deep.equal({ token: "x" });
      expect(followUps()).to.deep.equal([]);
    });

    it("is not met when the API client is public, without a second probe", async function () {
      keycloak.on(
        "POST",
        INTROSPECT,
        json(403, {
          error: "invalid_request",
          error_description: "Client not allowed.",
        }),
      );

      const res = await check();

      expect(rowOf(res, 7)).to.deep.equal({
        id: 7,
        status: "fail",
        reason: "api_client_public",
        details: { httpStatus: 403 },
      });
      expect(followUps()).to.deep.equal([]);
    });

    /**
     * Keycloak refusing the API client's credentials: the introspection
     * answers `401 invalid_client` whatever the cause, the token endpoint's
     * client credentials grant names it (`followUp`).
     */
    function refusingCredentials(followUp) {
      keycloak.on(
        "POST",
        INTROSPECT,
        json(401, {
          error: "invalid_client",
          error_description: "Client authentication failed.",
        }),
      );
      followUpAnswering(followUp);
    }

    it("is not met when the secret is wrong, told apart by a client credentials grant after the 401", async function () {
      refusingCredentials(
        json(401, {
          error: "unauthorized_client",
          error_description: "Invalid client or Invalid client credentials",
        }),
      );

      const res = await check();

      expect(rowOf(res, 7)).to.deep.equal({
        id: 7,
        status: "fail",
        reason: "api_client_secret_wrong",
      });
      const [followUp, ...more] = followUps();
      expect(more).to.deep.equal([]);
      expect(followUp.headers.authorization).to.equal(API_CLIENT_BASIC);
      expect(followUp.form).to.deep.equal({ grant_type: "client_credentials" });
    });

    it("is not met when Keycloak does not know the API client or it is disabled", async function () {
      refusingCredentials(
        json(401, {
          error: "invalid_client",
          error_description: "Invalid client or Invalid client credentials",
        }),
      );

      const res = await check();

      expect(rowOf(res, 7)).to.deep.equal({
        id: 7,
        status: "fail",
        reason: "api_client_unknown_or_disabled",
      });
    });

    const INCONCLUSIVE = [
      ["no answer in time", timeout()],
      [
        "an error that names no cause",
        json(400, { error: "unsupported_grant_type" }),
      ],
    ];

    for (const [what, followUp] of INCONCLUSIVE) {
      it(`is not met, naming every cause, when the 401 is followed by ${what}`, async function () {
        refusingCredentials(followUp);

        const res = await check();

        expect(rowOf(res, 7)).to.deep.equal({
          id: 7,
          status: "fail",
          reason: "introspection_unauthorized",
          details: { httpStatus: 401 },
        });
      });
    }

    it("is not checkable for an answer it does not know, without a second probe", async function () {
      keycloak.on(
        "POST",
        INTROSPECT,
        json(400, {
          error: "invalid_request",
          error_description: "Token not provided.",
        }),
      );

      const res = await check();

      expect(rowOf(res, 7)).to.deep.equal({
        id: 7,
        status: "na",
        reason: "unexpected_response",
        details: { httpStatus: 400, error: "invalid_request" },
      });
      expect(followUps()).to.deep.equal([]);
    });

    it("is not checkable when the introspection does not answer in time", async function () {
      keycloak.on("POST", INTROSPECT, timeout());

      const res = await check();

      expect(rowOf(res, 7)).to.deep.equal({
        id: 7,
        status: "na",
        reason: "timeout",
        details: { url: INTROSPECT },
      });
      expect(followUps()).to.deep.equal([]);
    });
  });

  /**
   * The introspection of a realm whose API client may introspect: the
   * dummy token of row 7 is inactive, any other token answers `answer`.
   */
  function introspectionAnswering(answer) {
    keycloak.on("POST", INTROSPECT, (req) =>
      req.form.token === "x" ? json(200, { active: false }) : answer,
    );
  }

  /** The introspections of a token other than row 7's dummy. */
  const tokenIntrospections = () =>
    requestsTo(INTROSPECT).filter((r) => r.form.token !== "x");

  describe("row 8, audience", function () {
    it("is not checkable while the owner is signed in locally", async function () {
      introspectionAnswering(json(200, { active: true }));

      const res = await check(h.as(ADMIN));

      expect(rowOf(res, 8)).to.deep.equal({
        id: 8,
        status: "na",
        reason: "sso_login_required",
      });
      expect(tokenIntrospections()).to.deep.equal([]);
    });

    it("is met when the token names the API client in aud and the API client finds it active", async function () {
      introspectionAnswering(
        json(200, { active: true, aud: API_CLIENT, azp: WEB_CLIENT }),
      );
      const signIn = ssoAs(webClientClaims({ aud: API_CLIENT }));

      const res = await check(signIn);

      expect(rowOf(res, 8)).to.deep.equal({
        id: 8,
        status: "ok",
        reason: "audience_present",
        details: { aud: [API_CLIENT] },
      });
      const [introspection] = tokenIntrospections();
      expect(introspection.headers.authorization).to.equal(API_CLIENT_BASIC);
      expect(introspection.form).to.deep.equal({
        token: signIn.Authorization.slice("Bearer ".length),
        token_type_hint: "access_token",
      });
    });

    it("is not met when the token carries no aud, without introspecting it", async function () {
      introspectionAnswering(json(200, { active: false }));

      const res = await check(ssoAs(webClientClaims({ aud: undefined })));

      expect(rowOf(res, 8)).to.deep.equal({
        id: 8,
        status: "fail",
        reason: "audience_missing",
        details: { aud: [] },
      });
      expect(tokenIntrospections()).to.deep.equal([]);
    });

    it("is not checkable when aud names the API client but the API client finds the token inactive", async function () {
      introspectionAnswering(json(200, { active: false }));

      const res = await check(
        ssoAs(webClientClaims({ aud: [API_CLIENT, "account"] })),
      );

      expect(rowOf(res, 8)).to.deep.equal({
        id: 8,
        status: "na",
        reason: "token_inactive",
        details: { aud: [API_CLIENT, "account"] },
      });
    });

    it("is not checkable with a token another client got, naming that client", async function () {
      introspectionAnswering(json(200, { active: true }));

      const res = await check(ssoAs(webClientClaims({ azp: "storefront" })));

      expect(rowOf(res, 8)).to.deep.equal({
        id: 8,
        status: "na",
        reason: "token_other_client",
        details: { azp: "storefront" },
      });
      expect(tokenIntrospections()).to.deep.equal([]);
    });

    it("is not checkable while the API client fails row 7, which drops it from aud (Keycloak 26.8.0)", async function () {
      keycloak.on(
        "POST",
        INTROSPECT,
        json(401, {
          error: "invalid_client",
          error_description: "Invalid client or Invalid client credentials",
        }),
      );
      followUpAnswering(json(401, { error: "invalid_client" }));

      const res = await check(ssoAs(webClientClaims({ aud: undefined })));

      expect(rowOf(res, 7).reason).to.equal("api_client_unknown_or_disabled");
      expect(rowOf(res, 8)).to.deep.equal({
        id: 8,
        status: "na",
        reason: "api_client_invalid",
      });
      expect(tokenIntrospections()).to.deep.equal([]);
    });

    it("is not checkable when the introspection of the token fails", async function () {
      introspectionAnswering(json(500, { error: "unknown_error" }));

      const res = await check(ssoAs(webClientClaims()));

      expect(rowOf(res, 8)).to.deep.equal({
        id: 8,
        status: "na",
        reason: "unexpected_response",
        details: { httpStatus: 500, error: "unknown_error" },
      });
    });
  });

  describe("row 9, client roles", function () {
    /** The stored role mapping is active: a Keycloak role maps to a role. */
    function withRoleMapping() {
      h.instance.applications = [
        keycloakApp({
          roleMapping: {
            active: true,
            roles: [
              {
                tenantId: "tenant-1",
                tenantRoleId: "role-all",
                keycloakRole: "biletado-admin",
              },
            ],
          },
        }),
      ];
    }

    beforeEach(function () {
      introspectionAnswering(json(200, { active: true }));
    });

    it("informs about the web client's roles of the owner's token", async function () {
      withRoleMapping();

      const res = await check(ssoAs(webClientClaims()));

      expect(rowOf(res, 9)).to.deep.equal({
        id: 9,
        status: "info",
        reason: "client_roles",
        details: { roles: ["biletado-admin"] },
      });
    });

    it("informs about no roles when the token carries none of the web client", async function () {
      withRoleMapping();

      const res = await check(
        ssoAs(
          webClientClaims({
            resource_access: { account: { roles: ["manage-account"] } },
          }),
        ),
      );

      expect(rowOf(res, 9)).to.deep.equal({
        id: 9,
        status: "info",
        reason: "client_roles",
        details: { roles: [] },
      });
    });

    it("is not checkable while the owner is signed in locally, like row 8", async function () {
      withRoleMapping();

      const res = await check(h.as(ADMIN));

      const notSso = { status: "na", reason: "sso_login_required" };
      expect(rowOf(res, 8)).to.deep.equal({ id: 8, ...notSso });
      expect(rowOf(res, 9)).to.deep.equal({ id: 9, ...notSso });
    });

    it("is not checkable with a token another client got, like row 8", async function () {
      withRoleMapping();

      const res = await check(ssoAs(webClientClaims({ azp: "storefront" })));

      const otherClient = {
        status: "na",
        reason: "token_other_client",
        details: { azp: "storefront" },
      };
      expect(rowOf(res, 8)).to.deep.equal({ id: 8, ...otherClient });
      expect(rowOf(res, 9)).to.deep.equal({ id: 9, ...otherClient });
    });

    it("is absent without an active role mapping", async function () {
      const res = await check(ssoAs(webClientClaims()));

      expect(res.body.rows.map((row) => row.id)).to.include.members([1, 7, 8]);
      expect(rowOf(res, 9)).to.equal(undefined);
    });

    it("is, like rows 7 and 8, not checkable when the realm is not, without a probe", async function () {
      withRoleMapping();
      keycloak.on(
        "GET",
        DISCOVERY,
        json(404, { error: "Realm does not exist" }),
      );

      const res = await check(ssoAs(webClientClaims()));

      expect(rowOf(res, 1).reason).to.equal("realm_not_found");
      for (const id of [7, 8, 9]) {
        expect(rowOf(res, id)).to.deep.equal({
          id,
          status: "na",
          reason: "realm_unavailable",
        });
      }
      expect(keycloak.requests.map((r) => r.path)).to.deep.equal([DISCOVERY]);
    });
  });
});
