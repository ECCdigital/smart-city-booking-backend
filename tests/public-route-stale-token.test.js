/**
 * A public route with a stale token (ECCdigital/tickets#109): a token the
 * client sends along is verified as on a protected route. An expired,
 * revoked or invalid one is refused with `401` and the protected route's
 * message, so the client knows to renew it instead of taking the anonymous
 * answer for its own; without a token the route stays anonymous.
 *
 * The probe is the pre-check of the checkout of an offer behind a login
 * (`GET /api/v2/:tenant/checkout/permissions/:id`), whose anonymous answer
 * - `200` with `checkout.login_required` - looks like "not signed in"; the
 * protected route to compare with is `GET /auth/me`. A revoked token is a
 * Keycloak session the introspection answers inactive: a local access
 * token is not revoked before it expires.
 */

const crypto = require("crypto");
const { expect } = require("chai");
const sinon = require("sinon");
const axios = require("axios");
const jwt = require("jsonwebtoken");

const {
  installHarness,
  bookable,
  TENANT,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const KeycloakVerifier = require("../src/commons/utilities/keycloak-verifier");
const {
  CHECKOUT_REASONS,
} = require("../src/commons/services/checkout/checkout-reasons");

const PRECHECK = `/api/v2/${TENANT}/checkout/permissions/login-room`;
const PROTECTED = "/auth/me";

const ISSUER = "https://idp.example.test/realms/city";
const KEYCLOAK_APP = {
  type: "auth",
  id: "keycloak",
  active: true,
  title: "Keycloak",
  serverUrl: "https://idp.example.test",
  realm: "city",
  publicClient: "booking-client",
  privateClient: "backend",
  privateClientSecret: "secret",
  roleMapping: { active: false },
};

/** The realm's signing key: what its JWKS endpoint would hand out. */
const realmKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

/** A Keycloak access token of the realm, signed and current. */
const keycloakToken = () =>
  jwt.sign(
    {
      sub: "kc-sub-1",
      sid: "kc-session-1",
      azp: "booking-client",
      aud: ["booking-client", "backend"],
      email: CUSTOMER,
    },
    realmKey.privateKey,
    { algorithm: "RS256", issuer: ISSUER, expiresIn: 300, keyid: "k1" },
  );

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

describe("public routes: a stale token is refused, no token stays anonymous", function () {
  this.timeout(20000);

  let h;

  before(async function () {
    h = await installHarness({
      bookables: {
        "login-room": bookable({
          id: "login-room",
          title: "Raum nur mit Anmeldung",
          requiresLogin: true,
        }),
      },
    });
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  /** The pre-check and the protected route, asked with the same headers. */
  async function bothWith(headers) {
    const precheck = await h.api().get(PRECHECK).set(headers);
    const protectedRoute = await h.api().get(PROTECTED).set(headers);
    return { precheck, protectedRoute };
  }

  function expectAnonymous(res) {
    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(false);
    expect(res.body.error.reason).to.equal(CHECKOUT_REASONS.LOGIN_REQUIRED);
  }

  describe("a token that fails its verification", function () {
    const cases = [
      [
        "an expired token",
        () => h.as(CUSTOMER, { expiresIn: -60 }),
        "Token has expired",
      ],
      [
        "a token signed with another key",
        () => bearer(jwt.sign({ sub: CUSTOMER }, "another-key")),
        "Invalid token",
      ],
      [
        "a header whose token is no JWT",
        () => bearer("garbage"),
        "Invalid token",
      ],
      [
        "a token whose payload is not JSON",
        () => bearer("eyJhbGciOiJIUzI1NiJ9.bm90IGpzb24.c2ln"),
        "Invalid token",
      ],
    ];

    for (const [name, headers, message] of cases) {
      it(`refuses ${name} with 401 "${message}", as the protected route does`, async function () {
        const { precheck, protectedRoute } = await bothWith(headers());

        expect(precheck.status).to.equal(401);
        expect(precheck.body).to.deep.equal({ success: false, message });
        expect(protectedRoute.status).to.equal(401);
        expect(protectedRoute.body).to.deep.equal(precheck.body);
      });
    }

    describe("a revoked Keycloak session", function () {
      beforeEach(function () {
        KeycloakVerifier.clearCache();
        h.instance.applications = [KEYCLOAK_APP];
        sinon
          .stub(KeycloakVerifier, "getSigningKey")
          .resolves(realmKey.publicKey.export({ type: "spki", format: "pem" }));
        sinon.stub(axios, "post").resolves({ data: { active: false } });
      });

      it("lets the same token through while the session is active", async function () {
        axios.post.resolves({ data: { active: true } });

        const res = await h.api().get(PRECHECK).set(bearer(keycloakToken()));

        expect(res.status).to.equal(200);
      });

      afterEach(function () {
        KeycloakVerifier.getSigningKey.restore();
        axios.post.restore();
        h.instance.applications = [];
        KeycloakVerifier.clearCache();
      });

      it('refuses it with 401 "SSO token verification failed", as the protected route does', async function () {
        const { precheck, protectedRoute } = await bothWith(
          bearer(keycloakToken()),
        );

        expect(precheck.status).to.equal(401);
        expect(precheck.body).to.deep.equal({
          success: false,
          message: "SSO token verification failed",
        });
        expect(protectedRoute.status).to.equal(401);
        expect(protectedRoute.body).to.deep.equal(precheck.body);
      });
    });
  });

  describe("no token", function () {
    it("answers anonymously without an authorization header", async function () {
      expectAnonymous(await h.api().get(PRECHECK));
    });

    it("answers anonymously to a bearer without a token", async function () {
      expectAnonymous(
        await h.api().get(PRECHECK).set({ Authorization: "Bearer " }),
      );
    });

    it("answers anonymously to another scheme than bearer", async function () {
      expectAnonymous(
        await h
          .api()
          .get(PRECHECK)
          .set({ Authorization: "Basic dXNlcjpwYXNz" }),
      );
    });
  });

  it("lets a valid token through as its user", async function () {
    const res = await h.api().get(PRECHECK).set(h.as(CUSTOMER));

    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ success: true });
  });
});
