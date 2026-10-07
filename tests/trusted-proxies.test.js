/**
 * The client address the registration limits count (ECCdigital/tickets#279):
 * the backend takes `X-Forwarded-For` only from the proxies `TRUSTED_PROXIES`
 * names, and without the variable it counts the direct address.
 *
 * Runs the real authentication router on a bare express app that is set up
 * like the server (`applyTrustedProxies`). The test client connects over
 * loopback, so `127.0.0.1` is the direct address. With a signup limit of one
 * per address, a second signup answers 429 exactly when it counts the same
 * address as the first.
 */

const assert = require("assert");
const express = require("express");
const request = require("supertest");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";
process.env.JWT_SECRET = process.env.JWT_SECRET || "registration-secret";

const { errorHandler } = require("../src/middleware/error-handler");
const UserManager = require("../src/commons/data-managers/user-manager");
const {
  applyTrustedProxies,
} = require("../src/commons/utilities/trusted-proxies");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");
const {
  installInMemoryMailTransport,
} = require("./helpers/in-memory-mail-transport");
const { installMailStackStore } = require("./helpers/mail-stack-fixtures");
const authenticationRouter = require("../src/platform/authentication/authentication-router");

const ENV_KEYS = ["TRUSTED_PROXIES", "RATE_LIMIT_SIGNUP_PER_IP"];

const CLIENT_A = "203.0.113.7";
const CLIENT_B = "203.0.113.8";
const CENTRAL_PROXY = "10.7.234.11";

function createApp() {
  const app = express();
  applyTrustedProxies(app);
  app.use(express.json());
  app.use("/auth", authenticationRouter);
  app.use(errorHandler);
  return app;
}

describe("trusted proxies: the client address the signup limit counts", function () {
  // The first signup renders the verification mail cold.
  this.timeout(10000);

  let savedEnv;
  let signups;

  beforeEach(function () {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.RATE_LIMIT_SIGNUP_PER_IP = "1";
    signups = 0;

    installInMemoryRateLimitEvents();
    installMailStackStore();
    installInMemoryMailTransport();
    const users = new Map();
    UserManager.getUser.restore();
    sinon.stub(UserManager, "getUser").callsFake(async (id, withSensitive) => {
      const user = users.get(String(id).toLowerCase());
      if (!user) return null;
      return withSensitive ? user : user.exportPublic();
    });
    for (const write of ["createUser", "updateUser"]) {
      sinon.stub(UserManager, write).callsFake(async (user) => {
        users.set(user.id, user);
        return user;
      });
    }
  });

  afterEach(function () {
    sinon.restore();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  /** Signs up a new address, sending `forwardedFor` as `X-Forwarded-For`. */
  function signup(app, forwardedFor) {
    const req = request(app).post("/auth/signup");
    if (forwardedFor !== undefined) req.set("X-Forwarded-For", forwardedFor);
    signups += 1;
    return req.send({
      id: `person-${signups}@example.test`,
      password: "secret-1234",
      firstName: "Neu",
      lastName: "Nutzer",
      legalAcceptance: true,
    });
  }

  describe("without TRUSTED_PROXIES", function () {
    it("counts the direct address, whatever X-Forwarded-For says", async function () {
      const app = createApp();

      const first = await signup(app, CLIENT_A);
      const second = await signup(app, CLIENT_B);

      assert.strictEqual(first.status, 201);
      assert.strictEqual(second.status, 429);
    });

    it("counts the direct address alike with an empty variable", async function () {
      process.env.TRUSTED_PROXIES = " ";
      const app = createApp();

      await signup(app, CLIENT_A);
      const second = await signup(app, CLIENT_B);

      assert.strictEqual(second.status, 429);
    });
  });

  describe("with the direct address among TRUSTED_PROXIES", function () {
    it("counts the client the proxy names", async function () {
      process.env.TRUSTED_PROXIES = "127.0.0.1";
      const app = createApp();

      const first = await signup(app, CLIENT_A);
      const otherClient = await signup(app, CLIENT_B);
      const sameClient = await signup(app, CLIENT_A);

      assert.strictEqual(first.status, 201);
      assert.strictEqual(otherClient.status, 201);
      assert.strictEqual(sameClient.status, 429);
    });

    it("counts the direct address of a request without the header", async function () {
      process.env.TRUSTED_PROXIES = "127.0.0.1";
      const app = createApp();

      await signup(app);
      const second = await signup(app);

      assert.strictEqual(second.status, 429);
    });

    it("ignores an entry the client set itself in front of the proxy's", async function () {
      process.env.TRUSTED_PROXIES = "127.0.0.1";
      const app = createApp();

      // The proxy appends the address it saw to the header the client sent.
      const first = await signup(app, `198.51.100.1, ${CLIENT_A}`);
      const forged = await signup(app, `198.51.100.2, ${CLIENT_A}`);

      assert.strictEqual(first.status, 201);
      assert.strictEqual(forged.status, 429);
    });
  });

  describe("over several hops", function () {
    it("counts the first address no trusted proxy stands for, networks included", async function () {
      process.env.TRUSTED_PROXIES = "127.0.0.1, 10.7.234.0/24";
      const app = createApp();

      const viaCentral = await signup(
        app,
        `198.51.100.1, ${CLIENT_A}, ${CENTRAL_PROXY}`,
      );
      const sameClientDirect = await signup(app, CLIENT_A);
      const otherClient = await signup(app, `${CLIENT_B}, ${CENTRAL_PROXY}`);

      assert.strictEqual(viaCentral.status, 201);
      assert.strictEqual(sameClientDirect.status, 429);
      assert.strictEqual(otherClient.status, 201);
    });

    it("stops at a hop that is not trusted and counts that hop", async function () {
      process.env.TRUSTED_PROXIES = "127.0.0.1";
      const app = createApp();

      const first = await signup(app, `${CLIENT_A}, ${CENTRAL_PROXY}`);
      const second = await signup(app, `${CLIENT_B}, ${CENTRAL_PROXY}`);

      assert.strictEqual(first.status, 201);
      assert.strictEqual(second.status, 429);
    });
  });

  it("refuses to start with an entry that is no address or network, naming the variable", function () {
    process.env.TRUSTED_PROXIES = "127.0.0.1, traefik";

    assert.throws(() => createApp(), /TRUSTED_PROXIES/);
  });
});
