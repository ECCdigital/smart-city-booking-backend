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

const LABOR = { id: "bank-1", name: "Labor Fachbank 1" };

/** A Fach of an Anlage with its own list, carrying its own scan codes. */
function fach(overrides = {}) {
  return {
    id: "fach-3",
    number: 3,
    lockerBank: LABOR,
    outOfService: false,
    scanCode: "code-fach-3",
    previousScanCodes: ["old-code-fach-3"],
    ...overrides,
  };
}

/** A Schließfachanlage of Open Locker that carries its own Fächer. */
function createAnlage(compartments = [fach()], overrides = {}) {
  return AccessPoint.create({
    id: "anlage-1",
    tenantId: "tenant-1",
    type: "locker",
    provider: "open-locker",
    label: "Fächer Bahnhof",
    mode: "remote",
    validationRules: [{ type: "qrScan" }],
    config: { compartments },
    ...overrides,
  });
}

describe("AccessScanService", () => {
  let sandbox;
  let log;
  let lockerSystemsByCode;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    log = sandbox.stub(AccessLogService, "log").resolves();
    lockerSystemsByCode = sandbox
      .stub(AccessPointManager, "getLockerSystemsByCompartmentScanCode")
      .resolves([]);
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

    it("names the rules of the door itself, because a scan knows no role", async () => {
      const accessPoint = createAccessPoint();
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(accessPoint);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        accessPoint.scanCode,
        "user-1",
      );

      expect(outcome.data.validationRuleTypes).to.deep.equal(["qrScan"]);
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
  describe("resolveScanCode at a Fach of a Schließfachanlage", () => {
    function noDoorCarriesTheCode() {
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(null);
    }

    it("resolves the code of a Fach to the Fach, under the id it is opened by", async () => {
      noDoorCarriesTheCode();
      lockerSystemsByCode.resolves([createAnlage()]);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        "code-fach-3",
        "user-1",
      );

      expect(outcome).to.deep.equal({
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

    it("never answers with the codes of the Fach or its UUID", async () => {
      noDoorCarriesTheCode();
      lockerSystemsByCode.resolves([createAnlage()]);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        "code-fach-3",
        "user-1",
      );

      const sent = JSON.stringify(outcome);
      expect(sent).to.not.include("code-fach-3");
      expect(sent).to.not.include("old-code-fach-3");
      expect(outcome.data).to.not.have.property("config");
      expect(outcome.data).to.not.have.property("externalId");
    });

    it("resolves a Fach out of service, saying so", async () => {
      noDoorCarriesTheCode();
      lockerSystemsByCode.resolves([
        createAnlage([fach({ outOfService: true })]),
      ]);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        "code-fach-3",
        "user-1",
      );

      expect(outcome.success).to.be.true;
      expect(outcome.data.compartment).to.deep.equal({
        number: 3,
        lockerBankName: "Labor Fachbank 1",
        outOfService: true,
      });
    });

    it("finds the Fach among the others of its Anlage", async () => {
      noDoorCarriesTheCode();
      lockerSystemsByCode.resolves([
        createAnlage([
          fach({
            id: "fach-1",
            number: 1,
            scanCode: "code-fach-1",
            previousScanCodes: [],
          }),
          fach(),
        ]),
      ]);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        "code-fach-3",
        "user-1",
      );

      expect(outcome.data.id).to.equal("anlage-1:fach-3");
      expect(outcome.data.compartment.number).to.equal(3);
    });

    it("writes no audit entry when the code of a Fach resolves", async () => {
      noDoorCarriesTheCode();
      lockerSystemsByCode.resolves([createAnlage()]);

      await AccessScanService.resolveScanCode(
        "tenant-1",
        "code-fach-3",
        "user-1",
      );

      expect(log.called).to.be.false;
    });

    it("reports a replaced code of a Fach as stale, naming the Fach", async () => {
      noDoorCarriesTheCode();
      lockerSystemsByCode.resolves([createAnlage()]);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        "old-code-fach-3",
        "user-1",
      );

      expect(outcome).to.deep.equal({
        success: false,
        data: { reason: "stale_scan_code", accessPointId: "anlage-1:fach-3" },
      });
    });

    it("audits a stale code of a Fach against that Fach", async () => {
      noDoorCarriesTheCode();
      lockerSystemsByCode.resolves([createAnlage()]);

      await AccessScanService.resolveScanCode(
        "tenant-1",
        "old-code-fach-3",
        "user-1",
      );

      expect(log.calledOnce).to.be.true;
      expect(log.firstCall.args[0]).to.deep.equal({
        tenantId: "tenant-1",
        accessPointId: "anlage-1:fach-3",
        accessPointType: "locker",
        provider: "open-locker",
        externalId: "fach-3",
        action: "scan",
        actor: { userId: "user-1", source: "user" },
        result: "denied",
        payload: { presentedScanCode: "old-code-fach-3" },
        errorCode: "stale_scan_code",
      });
    });

    it("reports a code two Fächer of one Anlage carry as unknown and audits it", async () => {
      noDoorCarriesTheCode();
      lockerSystemsByCode.resolves([
        createAnlage([
          fach({ id: "fach-1", number: 1, previousScanCodes: ["shared"] }),
          fach({ scanCode: "shared" }),
        ]),
      ]);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        "shared",
        "user-1",
      );

      expect(outcome).to.deep.equal({
        success: false,
        data: { reason: "unknown_scan_code", accessPointId: null },
      });
      expect(log.calledOnce).to.be.true;
      expect(log.firstCall.args[0]).to.deep.include({
        accessPointId: null,
        errorCode: "unknown_scan_code",
      });
    });

    it("reports a code Fächer of two Anlagen carry as unknown", async () => {
      noDoorCarriesTheCode();
      lockerSystemsByCode.resolves([
        createAnlage([fach({ scanCode: "shared" })]),
        createAnlage([fach({ scanCode: "shared" })], { id: "anlage-2" }),
      ]);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        "shared",
        "user-1",
      );

      expect(outcome.data).to.deep.equal({
        reason: "unknown_scan_code",
        accessPointId: null,
      });
    });

    it("reports a code a door and a Fach carry as unknown", async () => {
      const door = createAccessPoint();
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(door);
      lockerSystemsByCode.resolves([
        createAnlage([fach({ scanCode: door.scanCode })]),
      ]);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        door.scanCode,
        "user-1",
      );

      expect(outcome.data).to.deep.equal({
        reason: "unknown_scan_code",
        accessPointId: null,
      });
    });

    it("looks the code of a Fach up in the tenant of the request only", async () => {
      noDoorCarriesTheCode();

      await AccessScanService.resolveScanCode("tenant-1", "code-1", "user-1");

      expect(lockerSystemsByCode.calledOnceWithExactly("tenant-1", "code-1")).to
        .be.true;
    });

    it("leaves a door resolving as before when no Fach carries its code", async () => {
      const door = createAccessPoint();
      sandbox
        .stub(AccessPointManager, "getAccessPointByScanCode")
        .resolves(door);

      const outcome = await AccessScanService.resolveScanCode(
        "tenant-1",
        door.scanCode,
        "user-1",
      );

      expect(outcome.data.id).to.equal("point-1");
      expect(outcome.data).to.not.have.any.keys(
        "lockerSystemId",
        "compartment",
      );
    });
  });
});
