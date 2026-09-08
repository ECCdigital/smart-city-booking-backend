const { expect } = require("chai");
const sinon = require("sinon");

const {
  TenantController,
} = require("../src/platform/api/controllers/tenant-controller");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const MembershipService = require("../src/commons/services/membership/membership-service");

describe("TenantController.updateUserBookingNotificationRecipients", () => {
  let sandbox, req, res;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    req = {
      user: { id: "admin@stadt.de" },
      params: { tenant: "tenant-1" },
      body: {
        userId: "mitarbeiter@stadt.de",
        bookingNotificationRecipients: [
          { type: "email", value: "chef@stadt.de" },
        ],
      },
    };
    res = {
      status: sandbox.stub().returnsThis(),
      send: sandbox.stub(),
      sendStatus: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  // The right is the router's (`tenantUser.manage`): the controller checks
  // nothing.
  it("updates the recipients", async () => {
    sandbox
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ userId: "mitarbeiter@stadt.de", tenantId: "tenant-1" });
    const prepareStub = sandbox
      .stub(MembershipService, "prepareBookingNotificationRecipients")
      .resolves([{ type: "email", value: "chef@stadt.de", label: "" }]);
    const updateStub = sandbox
      .stub(MembershipManager, "updateMembership")
      .resolves();
    sandbox.stub(MembershipManager, "getMembershipsByTenantID").resolves([]);
    sandbox.stub(UserManager, "getUsersById").resolves([]);

    await TenantController.updateUserBookingNotificationRecipients(req, res);

    expect(
      prepareStub.calledOnceWith(
        "tenant-1",
        req.body.bookingNotificationRecipients,
      ),
    ).to.be.true;
    expect(
      updateStub.calledOnceWith("tenant-1", "mitarbeiter@stadt.de", {
        bookingNotificationRecipients: [
          { type: "email", value: "chef@stadt.de", label: "" },
        ],
      }),
    ).to.be.true;
    expect(res.status.calledWith(200)).to.be.true;
  });

  it("returns 404 when the membership does not exist", async () => {
    sandbox
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves(null);

    await TenantController.updateUserBookingNotificationRecipients(req, res);

    expect(res.status.calledWith(404)).to.be.true;
  });

  it("returns 400 for invalid recipient payloads", async () => {
    sandbox
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ userId: "mitarbeiter@stadt.de", tenantId: "tenant-1" });
    sandbox
      .stub(MembershipService, "prepareBookingNotificationRecipients")
      .rejects(new Error("invalid_booking_notification_recipient"));
    const updateStub = sandbox.stub(MembershipManager, "updateMembership");

    await TenantController.updateUserBookingNotificationRecipients(req, res);

    expect(res.status.calledWith(400)).to.be.true;
    expect(updateStub.called).to.be.false;
  });

  it("returns 400 when userId is missing", async () => {
    req.body.userId = undefined;

    await TenantController.updateUserBookingNotificationRecipients(req, res);

    expect(res.status.calledWith(400)).to.be.true;
  });
});
