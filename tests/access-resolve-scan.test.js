const { expect } = require("chai");
const sinon = require("sinon");

const AccessController = require("../src/platform/api/controllers/access-controller");
const AccessScanService = require("../src/commons/services/access/access-scan-service");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const PermissionsService = require("../src/commons/services/permission-service");
const { AccessPoint } = require("../src/commons/entities/access/access-point");

describe("AccessController.resolveScan", () => {
  let sandbox;
  let request;
  let response;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(PermissionsService, "_allowUpdateAny").resolves(false);

    request = {
      params: { tenant: "tenant-1", scanCode: "code-1" },
      query: {},
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

  it("resolves the code within the tenant of the path, for the signed-in user", async () => {
    const resolveScanCode = sandbox
      .stub(AccessScanService, "resolveScanCode")
      .resolves({ success: true, data: {} });

    await AccessController.resolveScan(request, response);

    expect(
      resolveScanCode.calledOnceWithExactly("tenant-1", "code-1", "user-1"),
    ).to.be.true;
  });

  it("reports the rules of the door to a user who may manage the bookings", async () => {
    PermissionsService._allowUpdateAny.resolves(true);
    const accessPoint = AccessPoint.create({
      id: "point-1",
      tenantId: "tenant-1",
      provider: "nuki",
      externalId: "lock-1",
      label: "Haupteingang",
    });
    accessPoint.scanCode = "code-1";
    sandbox
      .stub(AccessPointManager, "getAccessPointByScanCode")
      .resolves(accessPoint);

    await AccessController.resolveScan(request, response);

    expect(
      response.json.firstCall.args[0].data.validationRuleTypes,
    ).to.deep.equal(["qrScan"]);
  });

  it("answers a resolved code with the success envelope", async () => {
    sandbox.stub(AccessScanService, "resolveScanCode").resolves({
      success: true,
      data: {
        id: "point-1",
        label: "Haupteingang",
        type: "door",
        provider: "nuki",
        mode: "authorization",
      },
    });

    await AccessController.resolveScan(request, response);

    expect(response.status.calledWith(200)).to.be.true;
    expect(response.json.firstCall.args[0]).to.deep.equal({
      success: true,
      data: {
        id: "point-1",
        label: "Haupteingang",
        type: "door",
        provider: "nuki",
        mode: "authorization",
      },
    });
  });

  it("answers a stale code with HTTP 200 and the reason", async () => {
    sandbox.stub(AccessScanService, "resolveScanCode").resolves({
      success: false,
      data: { reason: "stale_scan_code", accessPointId: "point-1" },
    });

    await AccessController.resolveScan(request, response);

    expect(response.status.calledWith(200)).to.be.true;
    expect(response.json.firstCall.args[0]).to.deep.equal({
      success: false,
      data: { reason: "stale_scan_code", accessPointId: "point-1" },
    });
  });

  it("answers an unknown code with HTTP 200 and the reason", async () => {
    sandbox.stub(AccessScanService, "resolveScanCode").resolves({
      success: false,
      data: { reason: "unknown_scan_code", accessPointId: null },
    });

    await AccessController.resolveScan(request, response);

    expect(response.status.calledWith(200)).to.be.true;
    expect(response.json.firstCall.args[0]).to.deep.equal({
      success: false,
      data: { reason: "unknown_scan_code", accessPointId: null },
    });
  });

  it("answers an unexpected failure with a server error", async () => {
    sandbox
      .stub(AccessScanService, "resolveScanCode")
      .rejects(new Error("Database Error"));

    await AccessController.resolveScan(request, response);

    expect(response.status.calledWith(500)).to.be.true;
  });
});
