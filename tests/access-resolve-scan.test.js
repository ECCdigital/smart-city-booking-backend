const { expect } = require("chai");
const sinon = require("sinon");

const AccessController = require("../src/platform/api/controllers/access-controller");
const AccessScanService = require("../src/commons/services/access/access-scan-service");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const { AccessPoint } = require("../src/commons/entities/access/access-point");

describe("AccessController.resolveScan", () => {
  let sandbox;
  let request;
  let response;
  let lockerSystemsByCode;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
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
    lockerSystemsByCode = sandbox
      .stub(AccessPointManager, "getLockerSystemsByCompartmentScanCode")
      .resolves([]);
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

  it("reports the rule types of the door it resolved", async () => {
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

  it("answers the code of a Fach with the Fach of its Schließfachanlage", async () => {
    const anlage = AccessPoint.create({
      id: "anlage-1",
      tenantId: "tenant-1",
      type: "locker",
      provider: "open-locker",
      label: "Fächer Bahnhof",
      mode: "remote",
      validationRules: [{ type: "qrScan" }],
      config: {
        compartments: [
          {
            id: "fach-3",
            number: 3,
            lockerBank: { id: "bank-1", name: "Labor Fachbank 1" },
            outOfService: false,
            scanCode: "code-1",
            previousScanCodes: [],
          },
        ],
      },
    });
    sandbox.stub(AccessPointManager, "getAccessPointByScanCode").resolves(null);
    lockerSystemsByCode.resolves([anlage]);

    await AccessController.resolveScan(request, response);

    expect(response.status.calledWith(200)).to.be.true;
    expect(response.json.firstCall.args[0]).to.deep.equal({
      success: true,
      data: {
        id: "anlage-1:fach-3",
        tenantId: "tenant-1",
        lockerSystemId: "anlage-1",
        label: "Fächer Bahnhof",
        type: "locker",
        provider: "open-locker",
        mode: "remote",
        validationRuleTypes: ["qrScan"],
        capabilities: ["open"],
        compartment: {
          number: 3,
          lockerBankName: "Labor Fachbank 1",
          outOfService: false,
        },
      },
    });
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
