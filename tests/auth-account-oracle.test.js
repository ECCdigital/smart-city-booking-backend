/**
 * Sign-in, signup, verification resend and forgot password tell nobody
 * whether an address has an account (ECCdigital/tickets#259) - not by the
 * status, not by the text, not by the time of the answer:
 *
 * - the sign-in answers an unknown account, a wrong password and an SSO
 *   account alike; an unverified or suspended account learns its state only
 *   with the right password;
 * - signup, resend and forgot password answer before their mail goes out, and
 *   a mail that fails is only logged;
 * - an account is found by its exact address (the account id), trimmed and
 *   without regard to case, never by a pattern: `^own` and `.*` find nothing.
 *
 * Runs the real authentication router on a bare express app. The user store
 * sits below `UserManager`, at the model, so the query `UserManager` builds
 * is the one answered; the mail transport is a stand-in that can be slow or
 * refuse.
 */

const assert = require("assert");
const express = require("express");
const request = require("supertest");
const sinon = require("sinon");
const bunyan = require("bunyan");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";
process.env.JWT_SECRET = process.env.JWT_SECRET || "account-oracle-secret";

const { errorHandler } = require("../src/middleware/error-handler");
const authenticationRouter = require("../src/platform/authentication/authentication-router");
const UserManager = require("../src/commons/data-managers/user-manager");
const UserModel = require("../src/commons/data-managers/models/userModel");
const { User } = require("../src/commons/entities/user/user");
const { USER_HOOK_TYPES } = require("../src/commons/entities/user/userHook");
const UserService = require("../src/commons/services/user-service");
const MailerService = require("../src/commons/mail-service/mail-service");
const JwtHelper = require("../src/commons/utilities/jwt-helper");
const { whenIdle } = require("../src/commons/services/user/after-answer");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");
const { installMailStackStore } = require("./helpers/mail-stack-fixtures");

const OWNER = "owner@example.test";
const UNVERIFIED = "pending@example.test";
const SUSPENDED = "gesperrt@example.test";
const SSO = "sso@example.test";
const UNKNOWN = "nobody@example.test";
const PASSWORD = "richtig-1234";
const WRONG = "falsch-1234";

const VERIFICATION_SUBJECT = "Bestätigen Sie Ihre E-Mail-Adresse";
const RESET_SUBJECT = "Kennwort zurücksetzen";

function createApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/auth", authenticationRouter);
  app.use(errorHandler);
  return app;
}

/** A stored account as a plain document. */
function account(id, fields = {}) {
  const user = new User({
    id,
    firstName: "Konto",
    lastName: id.split("@")[0],
    isVerified: true,
    hooks: [],
    ...fields,
  });
  if (fields.authType === undefined || fields.authType === "local") {
    user.setPassword(PASSWORD);
  }
  return JSON.parse(JSON.stringify(user));
}

/**
 * The user collection in memory, behind `UserModel`. It answers the two
 * forms of an id condition MongoDB would - an exact value and `$regex` with
 * `$options` - and refuses every other filter, so a lookup it does not know
 * fails loudly instead of matching by accident.
 */
function installUserCollection(documents) {
  const docs = documents.map((doc) => ({ ...doc }));

  const matchesId = (stored, condition) => {
    if (typeof condition === "string") return stored === condition;
    if (
      condition &&
      typeof condition === "object" &&
      Object.keys(condition).every((key) =>
        ["$regex", "$options"].includes(key),
      )
    ) {
      return new RegExp(condition.$regex, condition.$options).test(stored);
    }
    throw new Error(`user collection: unsupported id condition ${condition}`);
  };
  const matches = (doc, filter) => {
    const keys = Object.keys(filter);
    if (keys.length !== 1 || keys[0] !== "id") {
      throw new Error(
        `user collection: unsupported filter ${JSON.stringify(filter)}`,
      );
    }
    return matchesId(doc.id, filter.id);
  };
  const asDocument = (doc) =>
    doc && {
      ...doc,
      toObject: () => JSON.parse(JSON.stringify(doc)),
      toEntity: () => new User(JSON.parse(JSON.stringify(doc))),
    };
  const plain = (user) => JSON.parse(JSON.stringify(user));

  sinon
    .stub(UserModel, "find")
    .callsFake(async (filter) =>
      docs.filter((doc) => matches(doc, filter)).map(asDocument),
    );
  // `findOne` answers what `find` answers, and the hook lookup of the
  // verification by `hooks.id`.
  sinon.stub(UserModel, "findOne").callsFake(async (filter) => {
    if (Object.keys(filter).length === 1 && "hooks.id" in filter) {
      return asDocument(
        docs.find((doc) =>
          (doc.hooks ?? []).some((hook) => hook.id === filter["hooks.id"]),
        ),
      );
    }
    return asDocument(docs.find((doc) => matches(doc, filter)));
  });
  sinon.stub(UserModel, "create").callsFake(async (user) => {
    docs.push(plain(user));
    return asDocument(docs[docs.length - 1]);
  });
  sinon.stub(UserModel, "findOneAndUpdate").callsFake(async (filter, user) => {
    const index = docs.findIndex((doc) => matches(doc, filter));
    if (index === -1) docs.push(plain(user));
    else docs[index] = plain(user);
    return asDocument(plain(user));
  });

  return docs;
}

/**
 * The mail transport: records what it sends; with a `failure` it refuses
 * every send the way an unreachable server would. `hold()` makes it the
 * slowest mail server there is: no send finishes until the returned release
 * is called, so an answer that waited for its mail would never arrive.
 */
function installTransport() {
  const transport = {
    failure: null,
    gate: null,
    sent: [],
    refused: 0,
    hold() {
      let release;
      this.gate = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        this.gate = null;
        release();
      };
    },
    async sendMail(options) {
      if (this.gate) await this.gate;
      if (this.failure) {
        this.refused += 1;
        throw new Error(this.failure);
      }
      this.sent.push(options);
      return { messageId: `<oracle-${this.sent.length}@example.test>` };
    },
    close() {},
  };
  sinon.stub(MailerService, "getTransporter").returns(transport);
  return transport;
}

describe("auth: no account oracle (ECCdigital/tickets#259)", function () {
  let app;
  let docs;
  let transport;

  before(function () {
    app = createApp();
  });

  beforeEach(function () {
    installInMemoryRateLimitEvents();
    installMailStackStore();
    // The mail stack fixture answers `getUser` itself; the store below the
    // manager answers it here.
    UserManager.getUser.restore();
    docs = installUserCollection([
      account(OWNER),
      account(UNVERIFIED, { isVerified: false }),
      account(SUSPENDED, { isSuspended: true }),
      account(SSO, { authType: "keycloak", keycloakId: "kc-1" }),
    ]);
    transport = installTransport();
    sinon.stub(UserManager, "getUserPermissions").resolves({ tenants: [] });
    sinon.stub(JwtHelper, "generateToken").resolves("access-token");
    sinon.stub(JwtHelper, "generateRefreshToken").resolves("refresh-token");
  });

  afterEach(async function () {
    await whenIdle();
    sinon.restore();
  });

  const signin = (id, password) =>
    request(app).post("/auth/signin").send({ id, password });
  const signup = (id) =>
    request(app).post("/auth/signup").send({
      id,
      password: "neu-1234",
      firstName: "Neu",
      lastName: "Nutzer",
    });
  const resend = (id) =>
    request(app)
      .post("/auth/resend-verification")
      .send({ id, verifyUrl: "https://store.example.test/verify" });
  const forgot = (id) =>
    request(app)
      .post("/auth/forgot-password")
      .send({ id, resetUrl: "https://store.example.test/reset" });

  const mailsTo = (address, subject) =>
    transport.sent.filter(
      (mail) => mail.to === address && mail.subject === subject,
    );

  describe("POST /auth/signin", function () {
    it("answers an unknown account, a wrong password and an SSO account alike", async function () {
      const unknown = await signin(UNKNOWN, PASSWORD);
      const wrongPassword = await signin(OWNER, WRONG);
      const sso = await signin(SSO, PASSWORD);

      assert.strictEqual(unknown.status, 401);
      assert.deepStrictEqual(unknown.body, {
        message: "Invalid email or password",
      });
      for (const res of [wrongPassword, sso]) {
        assert.strictEqual(res.status, unknown.status);
        assert.deepStrictEqual(res.body, unknown.body);
      }
    });

    it("tells an unverified account only with the right password", async function () {
      const unknown = await signin(UNKNOWN, WRONG);
      const wrong = await signin(UNVERIFIED, WRONG);
      const right = await signin(UNVERIFIED, PASSWORD);

      assert.strictEqual(wrong.status, unknown.status);
      assert.deepStrictEqual(wrong.body, unknown.body);
      // The Admin UI offers the verification mail again on exactly this.
      assert.strictEqual(right.status, 403);
      assert.deepStrictEqual(right.body, { message: "User is not verified" });
    });

    it("tells a suspended account only with the right password", async function () {
      const unknown = await signin(UNKNOWN, WRONG);
      const wrong = await signin(SUSPENDED, WRONG);
      const right = await signin(SUSPENDED, PASSWORD);

      assert.strictEqual(wrong.status, unknown.status);
      assert.deepStrictEqual(wrong.body, unknown.body);
      assert.strictEqual(right.status, 403);
      assert.deepStrictEqual(right.body, { message: "User is suspended" });
    });

    it("signs in a verified account with the right password", async function () {
      const res = await signin(OWNER, PASSWORD);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user.id, OWNER);
      assert.strictEqual(res.body.accessToken, "access-token");
    });

    it("finds the address in another case and with blanks around it", async function () {
      const res = await signin("  Owner@Example.TEST ", PASSWORD);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user.id, OWNER);
    });

    it("finds an account stored in another case and with blanks around it", async function () {
      docs.push({
        ...account("mixed.case@example.test"),
        id: " Mixed.Case@Example.test ",
      });

      const res = await signin("mixed.case@example.test", PASSWORD);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user.id.trim(), "mixed.case@example.test");
    });

    it("takes the account in lower case of two that differ only in case", async function () {
      docs.unshift({
        ...account(OWNER, { firstName: "Doppelt" }),
        id: "OWNER@example.test",
      });

      const res = await signin(OWNER, PASSWORD);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user.firstName, "Konto");
    });

    it("finds no account for a pattern, with the owner's password", async function () {
      const unknown = await signin(UNKNOWN, PASSWORD);

      for (const pattern of ["^own", ".*", "owner@example\\.test", "OWNER.*"]) {
        const res = await signin(pattern, PASSWORD);
        assert.strictEqual(res.status, unknown.status, pattern);
        assert.deepStrictEqual(res.body, unknown.body, pattern);
        assert.strictEqual(res.body.accessToken, undefined, pattern);
      }
    });

    it("refuses an address that is no string, as before", async function () {
      const res = await signin({ $ne: null }, PASSWORD);

      assert.strictEqual(res.status, 403);
      assert.deepStrictEqual(res.body, { message: "Authentication failed" });
    });
  });

  describe("POST /auth/forgot-password", function () {
    it("mails the reset link to the exact address only, never for a pattern", async function () {
      for (const pattern of [".*", "^own", "owner"]) {
        const res = await forgot(pattern);
        assert.strictEqual(res.status, 200, pattern);
      }
      await whenIdle();
      assert.strictEqual(transport.sent.length, 0);

      await forgot("  OWNER@example.test ");
      await whenIdle();

      assert.strictEqual(mailsTo(OWNER, RESET_SUBJECT).length, 1);
    });

    it("answers before the mail is out, a known address like an unknown one", async function () {
      const release = transport.hold();

      const known = await forgot(OWNER);
      const unknown = await forgot(UNKNOWN);

      assert.strictEqual(known.status, unknown.status);
      assert.strictEqual(known.text, unknown.text);
      assert.strictEqual(transport.sent.length, 0, "no mail out yet");

      release();
      await whenIdle();
      assert.strictEqual(mailsTo(OWNER, RESET_SUBJECT).length, 1);
    });

    it("answers alike when the mail cannot go out", async function () {
      // The transport tries three times, with a pause, before it gives up.
      this.timeout(30000);
      transport.failure = "smtp: 554 relay access denied";

      const known = await forgot(OWNER);
      const unknown = await forgot(UNKNOWN);

      assert.strictEqual(known.status, 200);
      assert.strictEqual(known.status, unknown.status);
      assert.strictEqual(known.text, unknown.text);
      await whenIdle();
      assert.ok(transport.refused > 0, "the mail was tried");
    });
  });

  describe("POST /auth/signup and /auth/resend-verification with a slow mail server", function () {
    let release;

    beforeEach(function () {
      release = transport.hold();
    });

    afterEach(function () {
      release();
    });

    it("signup answers at once and alike for a new, an unverified and a verified address", async function () {
      const fresh = await signup(UNKNOWN);
      const unverified = await signup(UNVERIFIED);
      const verified = await signup(OWNER);

      for (const res of [fresh, unverified, verified]) {
        assert.strictEqual(res.status, 201);
        assert.deepStrictEqual(res.body, fresh.body);
        assert.strictEqual(res.text, fresh.text);
      }
      assert.deepStrictEqual(fresh.body, {
        success: true,
        message:
          "If the address is not verified yet, a verification mail has been sent",
      });
      assert.strictEqual(transport.sent.length, 0, "no mail out yet");

      release();
      await whenIdle();
      assert.ok(
        docs.some((doc) => doc.id === UNKNOWN),
        "account created",
      );
      assert.strictEqual(mailsTo(UNKNOWN, VERIFICATION_SUBJECT).length, 1);
      assert.strictEqual(mailsTo(UNVERIFIED, VERIFICATION_SUBJECT).length, 1);
      assert.strictEqual(mailsTo(OWNER, VERIFICATION_SUBJECT).length, 0);
    });

    it("resend answers at once and alike for an unknown, an unverified and a verified address", async function () {
      const unverified = await resend(UNVERIFIED);
      const verified = await resend(OWNER);
      const unknown = await resend(UNKNOWN);

      for (const res of [unverified, verified, unknown]) {
        assert.strictEqual(res.status, 202);
        assert.deepStrictEqual(res.body, unverified.body);
      }
      // Registration and resend give the same answer.
      const fresh = await signup("neu@example.test");
      assert.deepStrictEqual(unverified.body, fresh.body);
      assert.strictEqual(transport.sent.length, 0, "no mail out yet");

      release();
      await whenIdle();
      assert.strictEqual(mailsTo(UNVERIFIED, VERIFICATION_SUBJECT).length, 1);
      assert.strictEqual(mailsTo(OWNER, VERIFICATION_SUBJECT).length, 0);
    });

    it("signs up the trimmed address, so the sign-in finds it", async function () {
      await signup("  Neu.Person@Example.test ");
      release();
      await whenIdle();

      assert.ok(docs.some((doc) => doc.id === "neu.person@example.test"));
    });

    it("finds no account for a pattern: resend mails nobody", async function () {
      await resend(".*");
      await resend("^pend");
      release();
      await whenIdle();

      assert.strictEqual(transport.sent.length, 0);
    });
  });

  describe("POST /auth/verify-email", function () {
    const verifyHook = (id) => ({
      id,
      type: USER_HOOK_TYPES.VERIFY,
      status: "active",
      payload: {},
    });

    beforeEach(function () {
      docs.find((doc) => doc.id === UNVERIFIED).hooks = [
        verifyHook("hook-pending"),
      ];
    });

    const verify = (token, id) =>
      request(app).post("/auth/verify-email").send({ token, id });
    const unverified = () => docs.find((doc) => doc.id === UNVERIFIED);

    it("verifies the account of the token, its address named in another case and with blanks around it", async function () {
      const res = await verify("hook-pending", "  Pending@Example.TEST ");

      assert.strictEqual(res.status, 200);
      assert.strictEqual(unverified().isVerified, true);
    });

    it("still refuses the token of another account", async function () {
      const res = await verify("hook-pending", OWNER);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(unverified().isVerified, false);
    });
  });

  describe("changing the id of an account", function () {
    it("refuses a new id that an account stored in another case has", async function () {
      // Two accounts, told apart by their database id; the second is an
      // older one that kept its case.
      docs.find((doc) => doc.id === OWNER)._id = "oid-owner";
      docs.push({
        ...account("erika@example.test"),
        _id: "oid-erika",
        id: "Erika@Example.test",
      });

      await assert.rejects(
        UserService.changeUserId({
          currentId: OWNER,
          newId: " erika@example.test",
        }),
        { status: 409, message: "Target user id already exists" },
      );
    });
  });

  describe("a verification mail that cannot go out", function () {
    const FAILURE = "smtp: 421 mail.example.test service not available";

    // The transport tries three times, with a pause, before it gives up.
    this.timeout(30000);

    it("is only logged: signup answers like a delivered one, without the server's text", async function () {
      const errors = sinon.spy(bunyan.prototype, "error");
      const delivered = await signup("erster@example.test");
      await whenIdle();
      transport.failure = FAILURE;

      const failed = await signup(UNKNOWN);
      const failedKnown = await signup(UNVERIFIED);

      for (const res of [failed, failedKnown]) {
        assert.strictEqual(res.status, delivered.status);
        assert.strictEqual(res.text, delivered.text);
        assert.ok(!res.text.includes("421"), "no text of the mail server");
      }
      await whenIdle();
      assert.ok(
        docs.some((doc) => doc.id === UNKNOWN),
        "account created",
      );
      const logged = errors
        .getCalls()
        .filter((call) => call.thisValue.fields.name === "after-answer.js");
      assert.ok(
        logged.some((call) => call.args[0]?.err?.message === FAILURE),
        "the failure is in the server's log",
      );
    });

    it("can be requested again right away", async function () {
      transport.failure = FAILURE;
      await signup(UNKNOWN);
      await whenIdle();
      assert.strictEqual(mailsTo(UNKNOWN, VERIFICATION_SUBJECT).length, 0);

      transport.failure = null;
      const res = await resend(UNKNOWN);
      await whenIdle();

      assert.strictEqual(res.status, 202);
      assert.strictEqual(mailsTo(UNKNOWN, VERIFICATION_SUBJECT).length, 1);
    });
  });
});
