/**
 * The links in the mails of the public authentication routes lead only to the
 * instance's own pages (ECCdigital/tickets#320, #480): forgot password takes
 * the client's `resetUrl`, signup and verification resend the client's
 * `verifyUrl`, the card signup the client's `linkUrl`, only when it is an
 * http(s) address on the origin of
 * `FRONTEND_URL`, `STORE_FRONT_URL` or `BACKEND_URL`. Anything else gets the
 * link built as without one, so a token never reaches a foreign host. The
 * answer is the same either way (ECCdigital/tickets#259).
 *
 * Runs the real authentication router on a bare express app, over the user
 * collection in memory and the in-memory mail transport.
 */

const assert = require("assert");
const express = require("express");
const request = require("supertest");
const sinon = require("sinon");
const Handlebars = require("handlebars");
const axios = require("axios");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";
process.env.JWT_SECRET = process.env.JWT_SECRET || "client-links-secret";

const { errorHandler } = require("../src/middleware/error-handler");
const authenticationRouter = require("../src/platform/authentication/authentication-router");
const UserManager = require("../src/commons/data-managers/user-manager");
const { USER_HOOK_TYPES } = require("../src/commons/entities/user/userHook");
const JwtHelper = require("../src/commons/utilities/jwt-helper");
const CardAuthService = require("../src/commons/services/card-auth/card-auth-service");
const { whenIdle } = require("../src/commons/services/user/after-answer");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");
const { installMailStackStore } = require("./helpers/mail-stack-fixtures");
const {
  installInMemoryMailTransport,
} = require("./helpers/in-memory-mail-transport");
const {
  account,
  installUserCollection,
} = require("./helpers/auth-user-collection");

const FRONTEND_URL = "https://buchung.example.test";
const STORE_FRONT_URL = "https://store.example.test";
const BACKEND_URL = "https://api.example.test";

const OWNER = "owner@example.test";
const PASSWORD = "richtig-1234";
const ATTACKER = "https://angreifer.example/fang";

const UNVERIFIED = "pending@example.test";
const NEW = "neu@example.test";

const RESET_SUBJECT = "Kennwort zurücksetzen";
const VERIFICATION_SUBJECT = "Bestätigen Sie Ihre E-Mail-Adresse";
const LINK_CARD_SUBJECT = "Karte mit Ihrem Account verknüpfen";
const ACCOUNT_EXISTS_SUBJECT =
  "Mit Ihrer E-Mail-Adresse besteht bereits ein Konto";

const CARD_APP = "stadtkarte";
const CARD = { publicId: "karte-1", secret: "geheim-1" };

/** The address as it stands in the rendered mail. */
const inMail = (url) => Handlebars.Utils.escapeExpression(url);

function createApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/auth", authenticationRouter);
  app.use(errorHandler);
  return app;
}

describe("auth: mail links lead to the instance's own pages (ECCdigital/tickets#320)", function () {
  let app;
  let docs;
  let sent;
  let env;

  before(function () {
    app = createApp();
    env = {
      FRONTEND_URL: process.env.FRONTEND_URL,
      STORE_FRONT_URL: process.env.STORE_FRONT_URL,
      BACKEND_URL: process.env.BACKEND_URL,
    };
    Object.assign(process.env, { FRONTEND_URL, STORE_FRONT_URL, BACKEND_URL });
  });

  after(function () {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(function () {
    installInMemoryRateLimitEvents();
    installMailStackStore();
    // The mail stack fixture answers `getUser` itself; the store below the
    // manager answers it here.
    UserManager.getUser.restore();
    docs = installUserCollection([
      account(OWNER, PASSWORD),
      account(UNVERIFIED, PASSWORD, { isVerified: false }),
    ]);
    sent = installInMemoryMailTransport();
    sinon.stub(UserManager, "getUserPermissions").resolves({ tenants: [] });
    sinon.stub(JwtHelper, "generateToken").resolves("access-token");
    sinon.stub(JwtHelper, "generateRefreshToken").resolves("refresh-token");
  });

  afterEach(async function () {
    await whenIdle();
    sinon.restore();
  });

  const activeHook = (id, type) =>
    docs
      .find((doc) => doc.id === id)
      .hooks.filter((hook) => hook.type === type && hook.status === "active")
      .pop();
  const lastMail = (to, subject) =>
    sent.filter((mail) => mail.to === to && mail.subject === subject).pop();

  describe("POST /auth/forgot-password", function () {
    const forgot = (resetUrl) =>
      request(app).post("/auth/forgot-password").send({ id: OWNER, resetUrl });

    it("links the own reset page instead of a foreign host", async function () {
      const res = await forgot(ATTACKER);
      await whenIdle();

      assert.strictEqual(res.status, 200);
      const hook = activeHook(OWNER, USER_HOOK_TYPES.FORGOT_PASSWORD);
      const mail = lastMail(OWNER, RESET_SUBJECT);
      assert.ok(
        mail.html.includes(
          inMail(
            `${FRONTEND_URL}/password/reset?token=${hook.id}&id=${encodeURIComponent(OWNER)}`,
          ),
        ),
      );
      assert.ok(!mail.html.includes("angreifer.example"));
      assert.deepStrictEqual(hook.payload, {});
    });

    it("keeps a page on an own origin, path and language prefix as named", async function () {
      for (const page of [
        `${STORE_FRONT_URL}/en/password/reset`,
        `${FRONTEND_URL}/password/reset`,
        `${BACKEND_URL}/reset`,
      ]) {
        await forgot(page);
        await whenIdle();

        const hook = activeHook(OWNER, USER_HOOK_TYPES.FORGOT_PASSWORD);
        assert.deepStrictEqual(hook.payload, { resetUrl: page });
        assert.ok(
          lastMail(OWNER, RESET_SUBJECT).html.includes(
            inMail(`${page}?token=${hook.id}&id=${encodeURIComponent(OWNER)}`),
          ),
          page,
        );
      }
    });

    it("drops every page off the own origins", async function () {
      for (const page of [
        "https://buchung.example.test.angreifer.example/password/reset",
        "https://buchung.example.test:8443/password/reset",
        "http://buchung.example.test/password/reset",
        "//angreifer.example/fang",
        "/password/reset",
        "javascript:alert(1)",
        { href: ATTACKER },
      ]) {
        await forgot(page);
        await whenIdle();

        const hook = activeHook(OWNER, USER_HOOK_TYPES.FORGOT_PASSWORD);
        assert.deepStrictEqual(hook.payload, {}, String(page));
        assert.ok(
          lastMail(OWNER, RESET_SUBJECT).html.includes(
            inMail(`${FRONTEND_URL}/password/reset?token=${hook.id}&`),
          ),
          String(page),
        );
      }
    });

    it("answers a foreign page like an own one and like none", async function () {
      const own = await forgot(`${STORE_FRONT_URL}/password/reset`);
      const foreign = await forgot(ATTACKER);
      const none = await forgot(undefined);

      for (const res of [foreign, none]) {
        assert.strictEqual(res.status, own.status);
        assert.strictEqual(res.text, own.text);
      }
      assert.strictEqual(own.status, 200);
    });
  });

  describe("POST /auth/signup with the address of a verified account (ECCdigital/tickets#600)", function () {
    const signup = (forgotPasswordUrl) =>
      request(app).post("/auth/signup").send({
        id: OWNER,
        password: "neu-1234",
        firstName: "Neu",
        lastName: "Nutzer",
        forgotPasswordUrl,
      });

    it("links the own forgot password page, path and language prefix as named", async function () {
      const page = `${STORE_FRONT_URL}/en/password/forgot`;
      const res = await signup(page);
      await whenIdle();

      assert.strictEqual(res.status, 201);
      const mail = lastMail(OWNER, ACCOUNT_EXISTS_SUBJECT);
      assert.ok(mail.html.includes(`href="${inMail(page)}"`));
    });

    for (const [name, page] of [
      ["a foreign host", ATTACKER],
      ["no page", undefined],
    ]) {
      it(`links the Admin UI's page for ${name}`, async function () {
        await signup(page);
        await whenIdle();

        const mail = lastMail(OWNER, ACCOUNT_EXISTS_SUBJECT);
        assert.ok(
          mail.html.includes(
            `href="${inMail(`${FRONTEND_URL}/password/reset`)}"`,
          ),
        );
        assert.ok(!mail.html.includes("angreifer"));
      });
    }
  });

  describe("POST /auth/signup and /auth/resend-verification", function () {
    const signup = (body) =>
      request(app)
        .post("/auth/signup")
        .send({
          id: NEW,
          password: "neu-1234",
          firstName: "Neu",
          lastName: "Nutzer",
          ...body,
        });
    const resend = (body) =>
      request(app)
        .post("/auth/resend-verification")
        .send({ id: UNVERIFIED, ...body });

    const flows = [
      { name: "signup", send: signup, to: NEW },
      { name: "resend", send: resend, to: UNVERIFIED },
    ];

    for (const { name, send, to } of flows) {
      it(`${name}: links the backend's verify route instead of a foreign host`, async function () {
        await send({ verifyUrl: ATTACKER });
        await whenIdle();

        const hook = activeHook(to, USER_HOOK_TYPES.VERIFY);
        const mail = lastMail(to, VERIFICATION_SUBJECT);
        assert.ok(
          mail.html.includes(inMail(`${BACKEND_URL}/auth/verify/${hook.id}`)),
        );
        assert.ok(!mail.html.includes("angreifer.example"));
        assert.ok(!hook.payload.verifyUrl, "no foreign page on the hook");
      });

      it(`${name}: keeps a verify page on an own origin, path and language prefix as named`, async function () {
        const page = `${STORE_FRONT_URL}/en/auth/verify`;

        await send({ verifyUrl: page });
        await whenIdle();

        const hook = activeHook(to, USER_HOOK_TYPES.VERIFY);
        assert.strictEqual(hook.payload.verifyUrl, page);
        assert.ok(
          lastMail(to, VERIFICATION_SUBJECT).html.includes(
            inMail(`${page}?token=${hook.id}&id=${encodeURIComponent(to)}`),
          ),
        );
      });

      it(`${name}: answers a foreign verify page like an own one`, async function () {
        const own = await send({ verifyUrl: `${STORE_FRONT_URL}/auth/verify` });
        const foreign = await send({ verifyUrl: ATTACKER });

        assert.strictEqual(foreign.status, own.status);
        assert.strictEqual(foreign.text, own.text);
      });
    }

    it("signup: keeps no return target on the origin of a foreign verify page", async function () {
      await signup({ verifyUrl: ATTACKER, nextUrl: `${ATTACKER}/weiter` });
      await whenIdle();

      const hook = activeHook(NEW, USER_HOOK_TYPES.VERIFY);
      assert.strictEqual(hook.payload.nextUrl, null);
      assert.ok(
        !lastMail(NEW, VERIFICATION_SUBJECT).html.includes("angreifer.example"),
      );
    });
  });
  describe("POST /auth/card/signup", function () {
    const cardSignup = (linkUrl) =>
      request(app)
        .post("/auth/card/signup")
        .send({ appId: CARD_APP, ...CARD, email: OWNER, linkUrl });

    beforeEach(function () {
      sinon.stub(CardAuthService, "getCardApp").resolves({
        id: CARD_APP,
        label: "Stadtkarte",
        serviceUrl: "https://karten.example.test",
        apiToken: "token",
        cardType: "stadtkarte",
      });
      // The card service knows the card; no account has it yet.
      sinon.stub(axios, "post").resolves({
        data: { valid: true, cardType: "stadtkarte" },
      });
      sinon.stub(UserManager, "getUserByCard").resolves(null);
    });

    it("links the backend's link route instead of a foreign host", async function () {
      const res = await cardSignup(ATTACKER);

      assert.strictEqual(res.status, 202);
      const hook = activeHook(OWNER, USER_HOOK_TYPES.LINK_CARD);
      const mail = lastMail(OWNER, LINK_CARD_SUBJECT);
      assert.ok(
        mail.html.includes(
          inMail(
            `${BACKEND_URL}/auth/card/link?token=${hook.id}&id=${encodeURIComponent(OWNER)}`,
          ),
        ),
      );
      assert.ok(!mail.html.includes("angreifer.example"));
    });

    it("keeps a link page on an own origin, path and language prefix as named", async function () {
      for (const page of [
        `${STORE_FRONT_URL}/en/card/link`,
        `${FRONTEND_URL}/card/link`,
      ]) {
        await cardSignup(page);

        const hook = activeHook(OWNER, USER_HOOK_TYPES.LINK_CARD);
        assert.ok(
          lastMail(OWNER, LINK_CARD_SUBJECT).html.includes(
            inMail(`${page}?token=${hook.id}&id=${encodeURIComponent(OWNER)}`),
          ),
          page,
        );
      }
    });

    it("drops every page off the own origins", async function () {
      for (const page of [
        "https://store.example.test.angreifer.example/card/link",
        "http://store.example.test/card/link",
        "//angreifer.example/fang",
        "/card/link",
        { href: ATTACKER },
      ]) {
        await cardSignup(page);

        const hook = activeHook(OWNER, USER_HOOK_TYPES.LINK_CARD);
        assert.ok(
          lastMail(OWNER, LINK_CARD_SUBJECT).html.includes(
            inMail(`${BACKEND_URL}/auth/card/link?token=${hook.id}&`),
          ),
          String(page),
        );
      }
    });

    it("answers a foreign link page like an own one and like none", async function () {
      const own = await cardSignup(`${STORE_FRONT_URL}/card/link`);
      const foreign = await cardSignup(ATTACKER);
      const none = await cardSignup(undefined);

      for (const res of [foreign, none]) {
        assert.strictEqual(res.status, own.status);
        assert.strictEqual(res.text, own.text);
      }
      assert.strictEqual(own.status, 202);
    });
  });
});
