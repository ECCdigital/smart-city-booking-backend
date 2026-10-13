/**
 * A write over the account id changes the account the lookup finds - the
 * exact address, trimmed and without regard to case (ECCdigital/tickets#259)
 * - and never makes a second one (ECCdigital/tickets#322). An account still
 * stored in another case keeps that spelling; aligning it belongs to a
 * migration of its own.
 *
 * Runs over the user collection in memory, below `UserManager` at the model;
 * the forgot password over the real authentication router on a bare express
 * app and the in-memory mail transport.
 */

const assert = require("assert");
const express = require("express");
const request = require("supertest");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";
process.env.JWT_SECRET = process.env.JWT_SECRET || "account-id-writes-secret";

const { errorHandler } = require("../src/middleware/error-handler");
const authenticationRouter = require("../src/platform/authentication/authentication-router");
const UserManager = require("../src/commons/data-managers/user-manager");
const { USER_HOOK_TYPES } = require("../src/commons/entities/user/userHook");
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

const PASSWORD = "richtig-1234";
const OLD_SPELLING = "Max.Muster@Example.de";
const LOWER = "max.muster@example.de";

/** The stored account as the collection holds it, with its stored id. */
function storedAccount(id, fields = {}) {
  const doc = account(LOWER, PASSWORD, fields);
  doc.id = id;
  return doc;
}

describe("UserManager: writes over the account id (ECCdigital/tickets#322)", function () {
  afterEach(function () {
    sinon.restore();
  });

  describe("updateUser", function () {
    it("changes the account in older spelling instead of making a second one", async function () {
      const docs = installUserCollection([storedAccount(OLD_SPELLING)]);

      const user = await UserManager.getUser(LOWER, true);
      user.firstName = "Maxi";
      await UserManager.updateUser(user);

      assert.strictEqual(docs.length, 1);
      assert.strictEqual(docs[0].id, OLD_SPELLING);
      assert.strictEqual(docs[0].firstName, "Maxi");
    });

    it("changes an SSO account in older spelling without failing on its keycloakId", async function () {
      const docs = installUserCollection([
        storedAccount(OLD_SPELLING, {
          authType: "keycloak",
          keycloakId: "kc-1",
        }),
      ]);

      const user = await UserManager.getUser(LOWER, true);
      user.phone = "0431 123";
      await UserManager.updateUser(user);

      assert.strictEqual(docs.length, 1);
      assert.strictEqual(docs[0].id, OLD_SPELLING);
      assert.strictEqual(docs[0].keycloakId, "kc-1");
      assert.strictEqual(docs[0].phone, "0431 123");
    });

    it("changes the account in lower case where both spellings are stored, as the lookup does", async function () {
      const docs = installUserCollection([
        storedAccount(OLD_SPELLING, { firstName: "Alt" }),
        storedAccount(LOWER, { firstName: "Neu" }),
      ]);

      await UserManager.updateUser({ id: OLD_SPELLING, company: "ECC" });

      assert.strictEqual(docs.length, 2);
      const [older, lower] = docs;
      assert.strictEqual(older.company, "");
      assert.strictEqual(lower.company, "ECC");
    });

    it("makes no account for an id nobody has", async function () {
      const docs = installUserCollection([storedAccount(OLD_SPELLING)]);

      await assert.rejects(
        UserManager.updateUser({ id: "nobody@example.de", firstName: "Neu" }),
        { name: "NotFoundError", code: "user_not_found" },
      );

      assert.deepStrictEqual(
        docs.map((doc) => doc.id),
        [OLD_SPELLING],
      );
    });
  });

  describe("deleteUser", function () {
    it("removes the account in older spelling", async function () {
      const docs = installUserCollection([
        storedAccount(OLD_SPELLING),
        storedAccount("andere@example.de"),
      ]);

      await UserManager.deleteUser(LOWER);

      assert.deepStrictEqual(
        docs.map((doc) => doc.id),
        ["andere@example.de"],
      );
    });
  });

  describe("POST /auth/forgot-password", function () {
    let app;

    before(function () {
      app = express();
      app.use(express.json());
      app.use("/auth", authenticationRouter);
      app.use(errorHandler);
    });

    beforeEach(function () {
      installInMemoryRateLimitEvents();
      installMailStackStore();
      // The mail stack fixture answers `getUser` itself; the store below the
      // manager answers it here.
      UserManager.getUser.restore();
      installInMemoryMailTransport();
    });

    afterEach(async function () {
      await whenIdle();
    });

    it("puts the reset on the account in older spelling and leaves exactly one", async function () {
      const docs = installUserCollection([storedAccount(OLD_SPELLING)]);
      const secret = docs[0].secret;

      const res = await request(app)
        .post("/auth/forgot-password")
        .send({ id: LOWER });
      await whenIdle();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(docs.length, 1);
      assert.strictEqual(docs[0].id, OLD_SPELLING);
      assert.strictEqual(docs[0].secret, secret);
      assert.deepStrictEqual(
        docs[0].hooks.map((hook) => [hook.type, hook.status]),
        [[USER_HOOK_TYPES.FORGOT_PASSWORD, "active"]],
      );
    });
  });
});
