/**
 * The registration refuses an address on the blacklist (glossary
 * „Blacklist“): signup by password, `sso/signup`
 * and `card/signup` ask the blacklist before an account is created. A hit
 * answers `409` with the checkout's reason and the instance's mail address
 * (empty without one), creates no account and sends no mail. Unlike the
 * neutral answers of the registration, this answer tells - on
 * purpose.
 *
 * Runs the real authentication router on a bare express app over the
 * in-memory blacklist, rate-limit events and mail transport; the user
 * store is a map, Keycloak and the card service answer through `axios`.
 */

const assert = require("assert");
const express = require("express");
const request = require("supertest");
const sinon = require("sinon");
const axios = require("axios");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";
process.env.JWT_SECRET = process.env.JWT_SECRET || "registration-secret";

const { errorHandler } = require("../src/middleware/error-handler");
const { whenIdle } = require("../src/commons/services/user/after-answer");
const UserManager = require("../src/commons/data-managers/user-manager");
const { User } = require("../src/commons/entities/user/user");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");
const {
  installInMemoryMailTransport,
} = require("./helpers/in-memory-mail-transport");
const {
  installMailStackStore,
  instance,
} = require("./helpers/mail-stack-fixtures");
const {
  installBlacklistCollection,
} = require("./helpers/blacklist-collection");

const INSTANCE_MAIL = instance().mailAddress;
const BLACKLISTED = "spam@example.test";
const BLACKLISTED_DOMAIN = "@wegwerf.example.test";
const KNOWN_BLACKLISTED = "bekannt@example.test";
const CLEAN = "neu@example.test";

const KEYCLOAK_APP = {
  id: "keycloak",
  serverUrl: "https://idp.example.test",
  realm: "city",
  privateClient: "backend",
  privateClientSecret: "secret",
  roleMapping: { active: false },
};

const CARD_APP = {
  id: "library-card",
  type: "card-auth",
  enabled: true,
  label: "Bibliotheksausweis",
  serviceUrl: "https://cards.example.test",
  apiToken: "card-token",
};

const REFUSAL = "checkout.address_blacklisted";

function createApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(
    "/auth",
    require("../src/platform/authentication/authentication-router"),
  );
  app.use(errorHandler);
  return app;
}

function entry(value) {
  return {
    id: `entry-${value}`,
    value,
    kind: value.startsWith("@") ? "domain" : "address",
    reason: "Spam",
    createdAt: Date.now(),
  };
}

describe("registration: an address on the blacklist", function () {
  // Each request waits for the work left for after its answer.
  this.timeout(10000);

  let app;
  let users;
  let sent;
  /** The e-mail the identity provider's token carries. */
  let ssoEmail;

  function installUserStore() {
    users = new Map([
      [
        KNOWN_BLACKLISTED,
        new User({
          id: KNOWN_BLACKLISTED,
          firstName: "Bekannt",
          lastName: "Nutzer",
          isVerified: true,
          hooks: [],
        }),
      ],
    ]);
    const store = async (user) => {
      users.set(user.id, user);
      return user;
    };
    // The mail stack fixture's own `getUser` gives way to this store.
    UserManager.getUser.restore();
    sinon.stub(UserManager, "getUser").callsFake(async (id, withSensitive) => {
      const user = users.get(String(id).toLowerCase());
      if (!user) return null;
      return withSensitive ? user : user.exportPublic();
    });
    sinon.stub(UserManager, "createUser").callsFake(store);
    sinon.stub(UserManager, "signupUser").callsFake(store);
    sinon.stub(UserManager, "updateUser").callsFake(store);
    sinon.stub(UserManager, "getUserByCard").resolves(null);
    sinon.stub(UserManager, "resolveKeycloakUser").callsFake(async (claims) => {
      if (users.has(claims.email)) return users.get(claims.email);
      throw { message: "User not found", status: 404 };
    });
  }

  /** Keycloak's introspection and the card service, both over `axios.post`. */
  function installProviders() {
    sinon.stub(axios, "post").callsFake(async (url) => {
      if (url.endsWith("/token/introspect")) {
        return {
          data: {
            active: true,
            sub: "kc-sub-1",
            email: ssoEmail,
            given_name: "Max",
            family_name: "Muster",
            resource_access: {},
          },
        };
      }
      if (url === `${CARD_APP.serviceUrl}/verify`) {
        return { data: { valid: true } };
      }
      throw new Error(`unexpected POST ${url}`);
    });
  }

  function setUp({ mailAddress = INSTANCE_MAIL } = {}) {
    installInMemoryRateLimitEvents();
    installMailStackStore({
      instance: instance({
        mailAddress,
        applications: [KEYCLOAK_APP, CARD_APP],
      }),
    });
    installBlacklistCollection([
      entry(BLACKLISTED),
      entry(BLACKLISTED_DOMAIN),
      entry(KNOWN_BLACKLISTED),
    ]);
    installUserStore();
    installProviders();
    sent = installInMemoryMailTransport();
  }

  before(function () {
    app = createApp();
  });

  beforeEach(function () {
    ssoEmail = CLEAN;
  });

  afterEach(function () {
    sinon.restore();
  });

  const signup = async (id) => {
    const res = await request(app).post("/auth/signup").send({
      id,
      password: "secret-1234",
      firstName: "Neu",
      lastName: "Nutzer",
      legalAcceptance: true,
    });
    await whenIdle();
    return res;
  };

  const ssoSignup = async (email) => {
    ssoEmail = email;
    const res = await request(app)
      .post("/auth/sso/signup")
      .send({ token: "kc-token" });
    await whenIdle();
    return res;
  };

  const cardSignup = async (email) => {
    const res = await request(app).post("/auth/card/signup").send({
      appId: CARD_APP.id,
      publicId: "4711",
      secret: "1234",
      email,
      firstName: "Karten",
      lastName: "Nutzer",
    });
    await whenIdle();
    return res;
  };

  function assertRefused(res, mailAddress) {
    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(
      { error: res.body.error, params: res.body.params },
      { error: REFUSAL, params: { mailAddress } },
    );
  }

  const PATHS = [
    ["by password", signup],
    ["by SSO", ssoSignup],
    ["by card", cardSignup],
  ];

  for (const [name, register] of PATHS) {
    describe(name, function () {
      it("refuses an address on the blacklist with the instance's mail address and creates no account", async function () {
        setUp();

        const res = await register(BLACKLISTED);

        assertRefused(res, INSTANCE_MAIL);
        assert.ok(!users.has(BLACKLISTED), "no account");
        assert.strictEqual(sent.length, 0, "no mail");
      });

      it("refuses an address whose domain is on the blacklist", async function () {
        setUp();

        const res = await register("jemand@wegwerf.example.test");

        assertRefused(res, INSTANCE_MAIL);
        assert.ok(!users.has("jemand@wegwerf.example.test"), "no account");
      });

      it("refuses the address however it is spelled", async function () {
        setUp();

        const res = await register("  SPAM@Example.test ");

        assertRefused(res, INSTANCE_MAIL);
        assert.strictEqual(users.size, 1, "no account");
      });

      it("answers an empty mail address where the instance has none", async function () {
        setUp({ mailAddress: "" });

        const res = await register(BLACKLISTED);

        assertRefused(res, "");
        assert.ok(!users.has(BLACKLISTED), "no account");
      });

      it("still creates the account of an address off the blacklist", async function () {
        setUp();

        const res = await register(CLEAN);

        assert.ok(res.status === 201, `status ${res.status}`);
        assert.ok(users.has(CLEAN), "account created");
      });
    });
  }

  it("by card, refuses linking the card to a known account on the blacklist", async function () {
    setUp();

    const res = await cardSignup(KNOWN_BLACKLISTED);

    assertRefused(res, INSTANCE_MAIL);
    assert.strictEqual(users.get(KNOWN_BLACKLISTED).hooks.length, 0);
    assert.strictEqual(sent.length, 0, "no link mail");
  });
});
