const { expect } = require("chai");
const sinon = require("sinon");

const SupervisorNotificationService = require("../src/commons/services/supervisor-notification-service");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const { RoleManager } = require("../src/commons/data-managers/role-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const MailController = require("../src/commons/mail-service/mail-controller");
const { BadRequestError } = require("../src/errors/BaseError");

describe("SupervisorNotificationService", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("prepareRecipientsForWrite", () => {
    it("rejects non-array payloads", async () => {
      let error;
      try {
        await SupervisorNotificationService.prepareRecipientsForWrite(
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
        await SupervisorNotificationService.prepareRecipientsForWrite(
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
        await SupervisorNotificationService.prepareRecipientsForWrite("t1", [
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
        await SupervisorNotificationService.prepareRecipientsForWrite("t1", [
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
        await SupervisorNotificationService.prepareRecipientsForWrite("t1", [
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
        await SupervisorNotificationService.prepareRecipientsForWrite("t1", [
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

  describe("resolveRecipientEmails", () => {
    it("resolves email recipients directly", async () => {
      const emails = await SupervisorNotificationService.resolveRecipientEmails(
        "t1",
        [{ type: "email", value: "sekretariat@stadt.de" }],
      );
      expect(emails).to.deep.equal(["sekretariat@stadt.de"]);
    });

    it("resolves user recipients when user exists", async () => {
      sandbox.stub(UserManager, "getUser").resolves({ id: "chef@stadt.de" });

      const emails = await SupervisorNotificationService.resolveRecipientEmails(
        "t1",
        [{ type: "user", value: "chef@stadt.de" }],
      );
      expect(emails).to.deep.equal(["chef@stadt.de"]);
    });

    it("skips user recipients that no longer exist", async () => {
      sandbox.stub(UserManager, "getUser").resolves(null);

      const emails = await SupervisorNotificationService.resolveRecipientEmails(
        "t1",
        [{ type: "user", value: "ghost@stadt.de" }],
      );
      expect(emails).to.deep.equal([]);
    });

    it("resolves role recipients to active members only", async () => {
      sandbox
        .stub(MembershipManager, "getMembershipsByTenantAndRoles")
        .resolves([
          { userId: "aktiv@stadt.de", status: "active" },
          { userId: "inaktiv@stadt.de", status: "suspended" },
          { userId: "wartend@stadt.de", status: "pending" },
        ]);

      const emails = await SupervisorNotificationService.resolveRecipientEmails(
        "t1",
        [{ type: "role", value: "leitung" }],
      );
      expect(emails).to.deep.equal(["aktiv@stadt.de"]);
    });

    it("deduplicates addresses across recipient types", async () => {
      sandbox.stub(UserManager, "getUser").resolves({ id: "chef@stadt.de" });
      sandbox
        .stub(MembershipManager, "getMembershipsByTenantAndRoles")
        .resolves([{ userId: "chef@stadt.de", status: "active" }]);

      const emails = await SupervisorNotificationService.resolveRecipientEmails(
        "t1",
        [
          { type: "user", value: "chef@stadt.de" },
          { type: "role", value: "leitung" },
          { type: "email", value: "Chef@Stadt.de" },
        ],
      );
      expect(emails).to.deep.equal(["chef@stadt.de"]);
    });

    it("excludes the booker from the recipient list", async () => {
      const emails = await SupervisorNotificationService.resolveRecipientEmails(
        "t1",
        [
          { type: "email", value: "chef@stadt.de" },
          { type: "email", value: "bucher@stadt.de" },
        ],
        { excludeEmails: ["Bucher@Stadt.de"] },
      );
      expect(emails).to.deep.equal(["chef@stadt.de"]);
    });

    it("skips invalid entries without failing", async () => {
      const emails = await SupervisorNotificationService.resolveRecipientEmails(
        "t1",
        [
          { type: "email", value: "not-an-email" },
          null,
          { type: "email", value: "gueltig@stadt.de" },
        ],
      );
      expect(emails).to.deep.equal(["gueltig@stadt.de"]);
    });

    it("continues resolving when a single lookup fails", async () => {
      sandbox.stub(UserManager, "getUser").rejects(new Error("db down"));

      const emails = await SupervisorNotificationService.resolveRecipientEmails(
        "t1",
        [
          { type: "user", value: "chef@stadt.de" },
          { type: "email", value: "gueltig@stadt.de" },
        ],
      );
      expect(emails).to.deep.equal(["gueltig@stadt.de"]);
    });
  });

  describe("notifySupervisorsOnBookingCreated", () => {
    let sendStub;

    beforeEach(() => {
      sendStub = sandbox
        .stub(MailController, "sendSupervisorBookingNotification")
        .resolves();
    });

    it("does nothing for guest bookings without user", async () => {
      const getTenant = sandbox.stub(TenantManager, "getTenant");

      await SupervisorNotificationService.notifySupervisorsOnBookingCreated({
        tenantId: "t1",
        userId: undefined,
        bookingIds: "b1",
      });

      expect(getTenant.called).to.be.false;
      expect(sendStub.called).to.be.false;
    });

    it("does nothing when the tenant feature flag is disabled", async () => {
      sandbox
        .stub(TenantManager, "getTenant")
        .resolves({ notifySupervisorsOnBooking: false });
      const getMembership = sandbox.stub(
        MembershipManager,
        "getMembershipByTenantAndUserID",
      );

      await SupervisorNotificationService.notifySupervisorsOnBookingCreated({
        tenantId: "t1",
        userId: "bucher@stadt.de",
        bookingIds: "b1",
      });

      expect(getMembership.called).to.be.false;
      expect(sendStub.called).to.be.false;
    });

    it("does nothing when no recipients are configured", async () => {
      sandbox
        .stub(TenantManager, "getTenant")
        .resolves({ notifySupervisorsOnBooking: true });
      sandbox
        .stub(MembershipManager, "getMembershipByTenantAndUserID")
        .resolves({ bookingNotificationRecipients: [] });

      await SupervisorNotificationService.notifySupervisorsOnBookingCreated({
        tenantId: "t1",
        userId: "bucher@stadt.de",
        bookingIds: "b1",
      });

      expect(sendStub.called).to.be.false;
    });

    it("sends one mail per resolved recipient, excluding the booker", async () => {
      sandbox
        .stub(TenantManager, "getTenant")
        .resolves({ notifySupervisorsOnBooking: true });
      sandbox
        .stub(MembershipManager, "getMembershipByTenantAndUserID")
        .resolves({
          bookingNotificationRecipients: [
            { type: "email", value: "chef@stadt.de" },
            { type: "email", value: "bucher@stadt.de" },
            { type: "email", value: "sekretariat@stadt.de" },
          ],
        });
      sandbox
        .stub(BookingManager, "getBooking")
        .resolves({ id: "b1", mail: "bucher@stadt.de" });

      await SupervisorNotificationService.notifySupervisorsOnBookingCreated({
        tenantId: "t1",
        userId: "bucher@stadt.de",
        bookingIds: "b1",
      });

      expect(sendStub.callCount).to.equal(2);
      const addresses = sendStub.getCalls().map((c) => c.args[0]);
      expect(addresses).to.have.members([
        "chef@stadt.de",
        "sekretariat@stadt.de",
      ]);
      expect(sendStub.firstCall.args[1]).to.deep.equal(["b1"]);
      expect(sendStub.firstCall.args[2]).to.equal("t1");
      expect(sendStub.firstCall.args[3]).to.equal(false);
    });

    it("sends aggregated notification for group bookings", async () => {
      sandbox
        .stub(TenantManager, "getTenant")
        .resolves({ notifySupervisorsOnBooking: true });
      sandbox
        .stub(MembershipManager, "getMembershipByTenantAndUserID")
        .resolves({
          bookingNotificationRecipients: [
            { type: "email", value: "chef@stadt.de" },
          ],
        });
      sandbox
        .stub(BookingManager, "getBooking")
        .resolves({ id: "b1", mail: "bucher@stadt.de" });

      await SupervisorNotificationService.notifySupervisorsOnBookingCreated({
        tenantId: "t1",
        userId: "bucher@stadt.de",
        bookingIds: ["b1", "b2"],
        aggregated: true,
      });

      expect(sendStub.calledOnce).to.be.true;
      expect(sendStub.firstCall.args[1]).to.deep.equal(["b1", "b2"]);
      expect(sendStub.firstCall.args[3]).to.equal(true);
    });

    it("does not throw when sending fails for a single recipient", async () => {
      sandbox
        .stub(TenantManager, "getTenant")
        .resolves({ notifySupervisorsOnBooking: true });
      sandbox
        .stub(MembershipManager, "getMembershipByTenantAndUserID")
        .resolves({
          bookingNotificationRecipients: [
            { type: "email", value: "chef@stadt.de" },
            { type: "email", value: "sekretariat@stadt.de" },
          ],
        });
      sandbox
        .stub(BookingManager, "getBooking")
        .resolves({ id: "b1", mail: "bucher@stadt.de" });

      sendStub.onFirstCall().rejects(new Error("smtp down"));
      sendStub.onSecondCall().resolves();

      await SupervisorNotificationService.notifySupervisorsOnBookingCreated({
        tenantId: "t1",
        userId: "bucher@stadt.de",
        bookingIds: "b1",
      });

      expect(sendStub.callCount).to.equal(2);
    });

    it("does not throw on unexpected errors", async () => {
      sandbox.stub(TenantManager, "getTenant").rejects(new Error("db down"));

      await SupervisorNotificationService.notifySupervisorsOnBookingCreated({
        tenantId: "t1",
        userId: "bucher@stadt.de",
        bookingIds: "b1",
      });

      expect(sendStub.called).to.be.false;
    });
  });
});
