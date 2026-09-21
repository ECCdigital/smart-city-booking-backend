/**
 * The public registration entry points (spec §6.3): signup, email check and
 * verification resend answer account-neutrally - the same status and body
 * whether the address is known or not - and the rate limits hold with
 * HTTP 429 and `Retry-After`.
 *
 * Runs the real authentication router on a bare express app over the
 * in-memory rate-limit events, the mail stack fixture and the in-memory mail
 * transport; the user store is a map the tests fill.
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
const { User } = require("../src/commons/entities/user/user");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");
const {
  installInMemoryMailTransport,
} = require("./helpers/in-memory-mail-transport");
const { installMailStackStore } = require("./helpers/mail-stack-fixtures");

const KNOWN_UNVERIFIED = "pending@example.test";
const KNOWN_VERIFIED = "erika@example.test";
const UNKNOWN = "nobody@example.test";
const IP_A = "203.0.113.7";
const IP_B = "203.0.113.8";

const ENV_KEYS = [
  "RATE_LIMIT_SIGNUP_PER_IP",
  "RATE_LIMIT_VERIFICATION_MAIL_PER_IP",
  "RATE_LIMIT_VERIFICATION_MAIL_PER_ACCOUNT_SHORT",
  "DISABLE_EMAIL_CHECK",
];

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

describe("public registration: account-neutral answers and rate limits", function () {
  let app;
  let users;
  let sent;
  let savedEnv;

  /** The user store: `getUser` reads it, `createUser`/`updateUser` write it. */
  function installUserStore() {
    users = new Map([
      [
        KNOWN_UNVERIFIED,
        new User({
          id: KNOWN_UNVERIFIED,
          firstName: "Paula",
          lastName: "Pending",
          isVerified: false,
          hooks: [],
        }),
      ],
      [
        KNOWN_VERIFIED,
        new User({
          id: KNOWN_VERIFIED,
          firstName: "Erika",
          lastName: "Musterfrau",
          isVerified: true,
          hooks: [],
        }),
      ],
    ]);
    UserManager.getUser.restore();
    sinon.stub(UserManager, "getUser").callsFake(async (id, withSensitive) => {
      const user = users.get(String(id).toLowerCase());
      if (!user) return null;
      return withSensitive ? user : user.exportPublic();
    });
    sinon.stub(UserManager, "createUser").callsFake(async (user) => {
      users.set(user.id, user);
      return user;
    });
    sinon.stub(UserManager, "updateUser").callsFake(async (user) => {
      users.set(user.id, user);
      return user;
    });
  }

  before(function () {
    app = createApp();
  });

  beforeEach(function () {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const key of ENV_KEYS) delete process.env[key];
    installInMemoryRateLimitEvents();
    installMailStackStore();
    installUserStore();
    sent = installInMemoryMailTransport();
  });

  afterEach(function () {
    sinon.restore();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  const signup = (id, ip = IP_A) =>
    request(app).post("/auth/signup").set("X-Forwarded-For", ip).send({
      id,
      password: "secret-1234",
      firstName: "Neu",
      lastName: "Nutzer",
      legalAcceptance: true,
    });

  const verificationMailsTo = (address) =>
    sent.filter(
      (mail) =>
        mail.to === address &&
        mail.subject === "Bestätigen Sie Ihre E-Mail-Adresse",
    );

  describe("POST /auth/signup", function () {
    it("creates the account of an unknown address and mails the verification", async function () {
      const res = await signup(UNKNOWN);

      assert.strictEqual(res.status, 201);
      assert.ok(users.has(UNKNOWN), "account created");
      assert.strictEqual(verificationMailsTo(UNKNOWN).length, 1);
    });

    it("answers a known address exactly like an unknown one and creates no second account", async function () {
      const fresh = await signup(UNKNOWN);
      const known = await signup(KNOWN_VERIFIED);
      const knownUnverified = await signup(KNOWN_UNVERIFIED);

      assert.strictEqual(known.status, fresh.status);
      assert.strictEqual(known.text, fresh.text);
      assert.strictEqual(knownUnverified.status, fresh.status);
      assert.strictEqual(knownUnverified.text, fresh.text);
      assert.strictEqual(users.get(KNOWN_VERIFIED).firstName, "Erika");
      assert.strictEqual(users.get(KNOWN_UNVERIFIED).firstName, "Paula");
      assert.strictEqual(users.size, 3);
    });

    it("mails an unverified known account its verification again, a verified one nothing", async function () {
      await signup(KNOWN_UNVERIFIED);
      await signup(KNOWN_VERIFIED);

      assert.strictEqual(verificationMailsTo(KNOWN_UNVERIFIED).length, 1);
      assert.strictEqual(verificationMailsTo(KNOWN_VERIFIED).length, 0);
    });

    it("answers 429 with Retry-After past the per-IP limit and creates no account", async function () {
      process.env.RATE_LIMIT_SIGNUP_PER_IP = "2";

      await signup("a@example.test");
      await signup("b@example.test");
      const third = await signup("c@example.test");

      assert.strictEqual(third.status, 429);
      assert.ok(Number(third.headers["retry-after"]) >= 1);
      assert.strictEqual(third.body.code, "too_many_requests");
      assert.ok(!users.has("c@example.test"), "no account past the limit");
    });

    it("counts per IP: another IP is not held back", async function () {
      process.env.RATE_LIMIT_SIGNUP_PER_IP = "1";

      await signup("a@example.test", IP_A);
      const otherIp = await signup("b@example.test", IP_B);

      assert.strictEqual(otherIp.status, 201);
    });

    it("wants an address and a password before it does anything", async function () {
      const noPassword = await request(app)
        .post("/auth/signup")
        .send({ id: KNOWN_VERIFIED });
      const noAddress = await request(app)
        .post("/auth/signup")
        .send({ password: "secret-1234" });

      assert.strictEqual(noPassword.status, 400);
      assert.strictEqual(noAddress.status, 400);
      assert.strictEqual(sent.length, 0);
    });

    it("holds the limit against parallel attempts", async function () {
      process.env.RATE_LIMIT_SIGNUP_PER_IP = "3";

      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => signup(`p${i}@example.test`)),
      );

      const created = results.filter((r) => r.status === 201).length;
      assert.ok(created <= 3, `${created} accounts created with a limit of 3`);
      assert.strictEqual(users.size - 2, created);
      for (const res of results.filter((r) => r.status !== 201)) {
        assert.strictEqual(res.status, 429);
      }
    });
  });

  describe("POST /auth/check-email", function () {
    it("answers a known and an unknown address alike", async function () {
      const known = await request(app)
        .post("/auth/check-email")
        .send({ email: KNOWN_VERIFIED });
      const unknown = await request(app)
        .post("/auth/check-email")
        .send({ email: UNKNOWN });

      assert.strictEqual(known.status, 200);
      assert.strictEqual(unknown.status, 200);
      assert.strictEqual(known.text, unknown.text);
    });

    it("still wants an address", async function () {
      const res = await request(app).post("/auth/check-email").send({});
      assert.strictEqual(res.status, 400);
    });
  });

  describe("POST /auth/resend-verification", function () {
    const resend = (id, ip = IP_A) =>
      request(app)
        .post("/auth/resend-verification")
        .set("X-Forwarded-For", ip)
        .send({ id, verifyUrl: "https://store.example.test/verify" });

    it("mails an unverified account and answers 202", async function () {
      const res = await resend(KNOWN_UNVERIFIED);

      assert.strictEqual(res.status, 202);
      assert.strictEqual(verificationMailsTo(KNOWN_UNVERIFIED).length, 1);
    });

    it("answers unknown, verified and unverified addresses alike", async function () {
      const unverified = await resend(KNOWN_UNVERIFIED);
      const verified = await resend(KNOWN_VERIFIED);
      const unknown = await resend(UNKNOWN);

      for (const res of [verified, unknown]) {
        assert.strictEqual(res.status, unverified.status);
        assert.deepStrictEqual(res.body, unverified.body);
      }
      assert.strictEqual(sent.length, 1);
    });

    it("applies the per-account minute limit silently", async function () {
      const first = await resend(KNOWN_UNVERIFIED);
      const second = await resend(KNOWN_UNVERIFIED);

      assert.strictEqual(second.status, first.status);
      assert.deepStrictEqual(second.body, first.body);
      assert.strictEqual(second.headers["retry-after"], undefined);
      assert.strictEqual(verificationMailsTo(KNOWN_UNVERIFIED).length, 1);
    });

    it("applies the per-IP limit visibly, for known and unknown addresses alike", async function () {
      process.env.RATE_LIMIT_VERIFICATION_MAIL_PER_IP = "2";

      await resend("x@example.test");
      await resend("y@example.test");
      const unknown = await resend(UNKNOWN);
      const known = await resend(KNOWN_UNVERIFIED);

      assert.strictEqual(unknown.status, 429);
      assert.strictEqual(known.status, 429);
      assert.strictEqual(
        known.headers["retry-after"],
        unknown.headers["retry-after"],
      );
      assert.strictEqual(verificationMailsTo(KNOWN_UNVERIFIED).length, 0);
    });

    it("counts the signup's own verification mail against the account window", async function () {
      await signup(UNKNOWN);
      await resend(UNKNOWN);

      assert.strictEqual(verificationMailsTo(UNKNOWN).length, 1);
    });

    it("wants an address", async function () {
      const res = await request(app).post("/auth/resend-verification").send({});
      assert.strictEqual(res.status, 400);
    });
  });
});
