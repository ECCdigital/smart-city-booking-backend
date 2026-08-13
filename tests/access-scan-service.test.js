const { expect } = require("chai");
const sinon = require("sinon");

const AccessScanService = require("../src/commons/services/access/access-scan-service");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const AccessLogService = require("../src/commons/services/access/access-log-service");
const { AccessPoint } = require("../src/commons/entities/access/access-point");

function createAccessPoint(overrides = {}) {
  return AccessPoint.create({
    id: "point-1",
    tenantId: "tenant-1",
    provider: "nuki",
    externalId: "lock-1",
    label: "Haupteingang",
    ...overrides,
  });
}

describe("AccessScanService", () => {
  let sandbox;
  let log;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    log = sandbox.stub(AccessLogService, "log").resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("resolveScanCode", () => {
    it("resolves a current scan code to the shared projection of the access point", async () => {
      const accessPoint = createAccessPoint();
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(accessPoint);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        accessPoint.scanCode,
        "user-1",
      );

      expect(outcome).to.deep.equal({
        success: true,
        data: {
          id: "point-1",
          tenantId: "tenant-1",
          label: "Haupteingang",
          type: "door",
          provider: "nuki",
          mode: "authorization",
          validationRuleTypes: ["qrScan"],
          capabilities: ["open", "close", "getStatus"],
        },
      });
    });

    it("knows no booking and answers with the core fields alone", async () => {
      const accessPoint = createAccessPoint();
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(accessPoint);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        accessPoint.scanCode,
        "user-1",
      );

      expect(outcome.data).to.not.have.any.keys(
        "accessFrom",
        "accessTo",
        "accessBuffer",
        "isProvisioned",
      );
    });

    it("asks a user who may manage the bookings for no evidence", async () => {
      const accessPoint = createAccessPoint();
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(accessPoint);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        accessPoint.scanCode,
        "user-1",
        { hasManagePermission: true },
      );

      expect(outcome.data.validationRuleTypes).to.deep.equal([]);
    });

    it("never answers with the scan codes themselves", async () => {
      const accessPoint = createAccessPoint();
      accessPoint.previousScanCodes = ["rotated-code"];
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(accessPoint);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        accessPoint.scanCode,
        "user-1",
      );

      expect(outcome.data).to.not.have.property("scanCode");
      expect(outcome.data).to.not.have.property("previousScanCodes");
    });

    it("writes no audit entry when the code resolves", async () => {
      const accessPoint = createAccessPoint();
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(accessPoint);

      await AccessScanService.resolveScanCode(
        "tenant-1",
        accessPoint.scanCode,
        "user-1",
      );

      expect(log.called).to.be.false;
    });

    it("reports a replaced scan code as stale, naming the access point", async () => {
      const accessPoint = createAccessPoint();
      accessPoint.previousScanCodes = ["rotated-code"];
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(accessPoint);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        "rotated-code",
        "user-1",
      );

      expect(outcome).to.deep.equal({
        success: false,
        data: { reason: "stale_scan_code", accessPointId: "point-1" },
      });
    });

    it("audits a stale scan code against the access point it belongs to", async () => {
      const accessPoint = createAccessPoint();
      accessPoint.previousScanCodes = ["rotated-code"];
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(accessPoint);

      await AccessScanService.resolveScanCode(
        "tenant-1",
        "rotated-code",
        "user-1",
      );

      expect(log.calledOnce).to.be.true;
      expect(log.firstCall.args[0]).to.deep.include({
        tenantId: "tenant-1",
        accessPointId: "point-1",
        accessPointType: "door",
        provider: "nuki",
        externalId: "lock-1",
        action: "scan",
        result: "denied",
        errorCode: "stale_scan_code",
      });
    });

    it("records the presented code under a key the audit export does not redact", async () => {
      const accessPoint = createAccessPoint();
      accessPoint.previousScanCodes = ["rotated-code"];
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(accessPoint);

      await AccessScanService.resolveScanCode(
        "tenant-1",
        "rotated-code",
        "user-1",
      );

      expect(log.firstCall.args[0].payload).to.deep.equal({
        presentedScanCode: "rotated-code",
      });
    });

    it("audits the user who presented the code", async () => {
      const accessPoint = createAccessPoint();
      accessPoint.previousScanCodes = ["rotated-code"];
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(accessPoint);

      await AccessScanService.resolveScanCode(
        "tenant-1",
        "rotated-code",
        "user-1",
      );

      expect(log.firstCall.args[0].actor).to.deep.equal({
        userId: "user-1",
        source: "user",
      });
    });

    it("reports a code no access point carries as unknown", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(null);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        "never-issued",
        "user-1",
      );

      expect(outcome).to.deep.equal({
        success: false,
        data: { reason: "unknown_scan_code", accessPointId: null },
      });
    });

    it("audits an unknown scan code without an access point", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(null);

      await AccessScanService.resolveScanCode(
        "tenant-1",
        "never-issued",
        "user-1",
      );

      expect(log.calledOnce).to.be.true;
      expect(log.firstCall.args[0]).to.deep.include({
        tenantId: "tenant-1",
        accessPointId: null,
        action: "scan",
        result: "denied",
        errorCode: "unknown_scan_code",
      });
      expect(log.firstCall.args[0].payload).to.deep.equal({
        presentedScanCode: "never-issued",
      });
    });

    it("looks the code up in the tenant of the request only", async () => {
      const getAccessPointByScanCode = sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(null);

      await AccessScanService.resolveScanCode("tenant-1", "code-1", "user-1");

      expect(
        getAccessPointByScanCode.calledOnceWithExactly("tenant-1", "code-1"),
      ).to.be.true;
    });
  });
});
