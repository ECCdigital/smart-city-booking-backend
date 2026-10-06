/**
 * The resolution of the supervisors' recipients
 * (`mail-service/recipients.js`, glossary "Aufsicht"): the entries of a
 * membership - by address, by account, by role - into addresses, once
 * each, invalid or dangling ones skipped, the booker left out. Moved here
 * from `supervisor-notification-service.test.js` with the mail-stack chain;
 * who gets which notice is `mail-compose.test.js`.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  resolveRecipientEmails,
} = require("../src/commons/mail-service/recipients");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const UserManager = require("../src/commons/data-managers/user-manager");

describe("mail recipients", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("resolveRecipientEmails", function () {
    it("resolves email recipients directly", async function () {
      const emails = await resolveRecipientEmails("t1", [
        { type: "email", value: "sekretariat@stadt.de" },
      ]);
      expect(emails).to.deep.equal(["sekretariat@stadt.de"]);
    });

    it("resolves user recipients when user exists", async function () {
      sandbox.stub(UserManager, "getUser").resolves({ id: "chef@stadt.de" });

      const emails = await resolveRecipientEmails("t1", [
        { type: "user", value: "chef@stadt.de" },
      ]);
      expect(emails).to.deep.equal(["chef@stadt.de"]);
    });

    it("skips user recipients that no longer exist", async function () {
      sandbox.stub(UserManager, "getUser").resolves(null);

      const emails = await resolveRecipientEmails("t1", [
        { type: "user", value: "ghost@stadt.de" },
      ]);
      expect(emails).to.deep.equal([]);
    });

    it("resolves role recipients to active members only", async function () {
      sandbox
        .stub(MembershipManager, "getMembershipsByTenantAndRoles")
        .resolves([
          { userId: "aktiv@stadt.de", status: "active" },
          { userId: "inaktiv@stadt.de", status: "suspended" },
          { userId: "wartend@stadt.de", status: "pending" },
        ]);

      const emails = await resolveRecipientEmails("t1", [
        { type: "role", value: "leitung" },
      ]);
      expect(emails).to.deep.equal(["aktiv@stadt.de"]);
    });

    it("deduplicates addresses across recipient types", async function () {
      sandbox.stub(UserManager, "getUser").resolves({ id: "chef@stadt.de" });
      sandbox
        .stub(MembershipManager, "getMembershipsByTenantAndRoles")
        .resolves([{ userId: "chef@stadt.de", status: "active" }]);

      const emails = await resolveRecipientEmails("t1", [
        { type: "user", value: "chef@stadt.de" },
        { type: "role", value: "leitung" },
        { type: "email", value: "Chef@Stadt.de" },
      ]);
      expect(emails).to.deep.equal(["chef@stadt.de"]);
    });

    it("excludes the booker from the recipient list", async function () {
      const emails = await resolveRecipientEmails(
        "t1",
        [
          { type: "email", value: "chef@stadt.de" },
          { type: "email", value: "bucher@stadt.de" },
        ],
        { excludeEmails: ["Bucher@Stadt.de"] },
      );
      expect(emails).to.deep.equal(["chef@stadt.de"]);
    });

    it("skips invalid entries without failing", async function () {
      const emails = await resolveRecipientEmails("t1", [
        { type: "email", value: "not-an-email" },
        null,
        { type: "email", value: "gueltig@stadt.de" },
      ]);
      expect(emails).to.deep.equal(["gueltig@stadt.de"]);
    });

    it("continues resolving when a single lookup fails", async function () {
      sandbox.stub(UserManager, "getUser").rejects(new Error("db down"));

      const emails = await resolveRecipientEmails("t1", [
        { type: "user", value: "chef@stadt.de" },
        { type: "email", value: "gueltig@stadt.de" },
      ]);
      expect(emails).to.deep.equal(["gueltig@stadt.de"]);
    });
  });
});
