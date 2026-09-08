const { expect } = require("chai");
const sinon = require("sinon");

const MembershipService = require("../src/commons/services/membership/membership-service");
const UserManager = require("../src/commons/data-managers/user-manager");
const { RoleManager } = require("../src/commons/data-managers/role-manager");
const { BadRequestError } = require("../src/errors/BaseError");

/**
 * The write side of the supervisors (glossary "Aufsicht"):
 * `MembershipService.prepareBookingNotificationRecipients` validates the
 * recipient entries of a membership before they are stored. Moved here from
 * `supervisor-notification-service.test.js` with the mail-stack chain; the
 * resolution into addresses is `mail-recipients.test.js`.
 */

describe("MembershipService.prepareBookingNotificationRecipients", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("prepareBookingNotificationRecipients", () => {
    it("rejects non-array payloads", async () => {
      let error;
      try {
        await MembershipService.prepareBookingNotificationRecipients(
          "t1",
          "invalid",
        );
      } catch (err) {
        error = err;
      }
      expect(error).to.be.instanceOf(BadRequestError);
    });

    it("rejects more than 10 recipients", async () => {
      const tooMany = Array.from({ length: 11 }, (_, i) => ({
        type: "email",
        value: `mail${i}@stadt.de`,
      }));

      let error;
      try {
        await MembershipService.prepareBookingNotificationRecipients(
          "t1",
          tooMany,
        );
      } catch (err) {
        error = err;
      }
      expect(error).to.be.instanceOf(BadRequestError);
      expect(error.code).to.equal("too_many_booking_notification_recipients");
    });

    it("rejects structurally invalid entries", async () => {
      let error;
      try {
        await MembershipService.prepareBookingNotificationRecipients("t1", [
          { type: "email", value: "not-an-email" },
        ]);
      } catch (err) {
        error = err;
      }
      expect(error).to.be.instanceOf(BadRequestError);
      expect(error.code).to.equal("invalid_booking_notification_recipient");
    });

    it("rejects user recipients that do not exist", async () => {
      sandbox.stub(UserManager, "getUser").resolves(null);

      let error;
      try {
        await MembershipService.prepareBookingNotificationRecipients("t1", [
          { type: "user", value: "ghost@stadt.de" },
        ]);
      } catch (err) {
        error = err;
      }
      expect(error).to.be.instanceOf(BadRequestError);
      expect(error.code).to.equal(
        "booking_notification_recipient_user_not_found",
      );
    });

    it("rejects role recipients that do not exist in the tenant", async () => {
      sandbox.stub(RoleManager, "getRole").resolves(null);

      let error;
      try {
        await MembershipService.prepareBookingNotificationRecipients("t1", [
          { type: "role", value: "unknown-role" },
        ]);
      } catch (err) {
        error = err;
      }
      expect(error).to.be.instanceOf(BadRequestError);
      expect(error.code).to.equal(
        "booking_notification_recipient_role_not_found",
      );
    });

    it("sanitizes and deduplicates valid entries", async () => {
      sandbox.stub(UserManager, "getUser").resolves({ id: "chef@stadt.de" });
      sandbox.stub(RoleManager, "getRole").resolves({ id: "leitung" });

      const result =
        await MembershipService.prepareBookingNotificationRecipients("t1", [
          { type: "user", value: " Chef@Stadt.DE " },
          { type: "user", value: "chef@stadt.de" },
          { type: "role", value: "leitung", label: " Leitung " },
          { type: "email", value: "Sekretariat@Stadt.de" },
        ]);

      expect(result).to.deep.equal([
        { type: "user", value: "chef@stadt.de", label: "" },
        { type: "role", value: "leitung", label: "Leitung" },
        { type: "email", value: "sekretariat@stadt.de", label: "" },
      ]);
    });
  });
});
