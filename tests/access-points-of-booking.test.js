const { expect } = require("chai");
const sinon = require("sinon");

const AccessController = require("../src/platform/api/controllers/access-controller");
const AccessService = require("../src/commons/services/access/access-service");
const PermissionsService = require("../src/commons/services/permission-service");

describe("AccessController.getAccessPoints", () => {
  let sandbox;
  let request;
  let response;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(PermissionsService, "_allowUpdateAny").resolves(true);
    sandbox.stub(AccessService, "canView").resolves(true);

    request = {
      params: { tenant: "tenant-1" },
      query: { bookingId: "booking-1" },
      body: {},
      user: { id: "user-1" },
    };
    response = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub(),
      sendStatus: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("names the asking user, whose role at the booking decides what is demanded", async () => {
    const getByBooking = sandbox
      .stub(AccessService, "getByBooking")
      .resolves([]);

    await AccessController.getAccessPoints(request, response);

    expect(
      getByBooking.calledOnceWithExactly("tenant-1", "booking-1", {
        userId: "user-1",
        hasManagePermission: true,
      }),
    ).to.be.true;
  });

  it("asks nobody's role for a booking the user may not view", async () => {
    AccessService.canView.resolves(false);
    const getByBooking = sandbox
      .stub(AccessService, "getByBooking")
      .resolves([]);

    await AccessController.getAccessPoints(request, response);

    expect(response.sendStatus.calledWith(403)).to.be.true;
    expect(getByBooking.called).to.be.false;
  });
});
