const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

const { AccessPoint } = require("../src/commons/entities/access/access-point");
const { ValidationError } = require("../src/errors/ValidationError");
const { TEST_GEO_RULE } = require("./helpers/test-validation-rule");

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

/**
 * What the controller does with an access point. Who may read and who may
 * write is the routes' (`accessPoint.read`, `accessPoint.write`) and is
 * pinned in `authorization-access-routes.test.js`, not here.
 */
describe("AccessPointController", () => {
  let sandbox;
  let AccessPointController;
  let AccessPointManager;
  let AccessQrService;
  let AccessLocationService;
  let AccessInfoService;
  let BookableManager;
  let request;
  let response;
  let next;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mock("../src/middleware/logger", () => ({
      error: sandbox.stub(),
      warn: sandbox.stub(),
      info: sandbox.stub(),
      debug: sandbox.stub(),
    }));

    AccessPointController = mock.reRequire(
      "../src/platform/api/controllers/access-point-controller.js",
    );
    AccessPointManager = require("../src/commons/data-managers/access-point-manager");
    AccessQrService = require("../src/commons/services/access/access-qr-service");
    AccessLocationService = require("../src/commons/services/access/access-location-service");
    AccessInfoService = require("../src/commons/services/access/access-info-service");
    BookableManager =
      require("../src/commons/data-managers/bookable-manager").BookableManager;

    request = {
      params: { tenant: "tenant-1" },
      query: {},
      body: {},
      user: { id: "user-1" },
    };
    response = {
      status: sandbox.stub().returnsThis(),
      send: sandbox.stub(),
      json: sandbox.stub(),
      sendStatus: sandbox.stub(),
      setHeader: sandbox.stub(),
    };
    next = sandbox.stub();
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  describe("getAccessPoints", () => {
    it("only lists access points of the tenant in the path", async () => {
      const getAccessPoints = sandbox
        .stub(AccessPointManager, "getAccessPoints")
        .resolves([]);

      await AccessPointController.getAccessPoints(request, response, next);

      expect(getAccessPoints.calledOnceWithExactly("tenant-1")).to.be.true;
    });

    it("sends the access points without their scan codes", async () => {
      const accessPoint = createAccessPoint();
      accessPoint.previousScanCodes = ["rotated-code"];
      sandbox
        .stub(AccessPointManager, "getAccessPoints")
        .resolves([accessPoint]);

      await AccessPointController.getAccessPoints(request, response, next);

      expect(response.status.calledWith(200)).to.be.true;
      const sent = response.send.firstCall.args[0];
      expect(sent).to.have.length(1);
      expect(sent[0]).to.not.have.property("scanCode");
      expect(sent[0]).to.not.have.property("previousScanCodes");
      expect(sent[0].id).to.equal("point-1");
    });

    it("hands unexpected errors to the error handler", async () => {
      const failure = new Error("Database Error");
      sandbox.stub(AccessPointManager, "getAccessPoints").rejects(failure);

      await AccessPointController.getAccessPoints(request, response, next);

      expect(next.calledOnceWithExactly(failure)).to.be.true;
    });
  });

  describe("getAccessPoint", () => {
    beforeEach(() => {
      request.params.id = "point-1";
    });

    it("answers 404 for an access point of another tenant", async () => {
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(null);

      await AccessPointController.getAccessPoint(request, response, next);

      expect(response.sendStatus.calledWith(404)).to.be.true;
    });

    it("sends the access point without its scan codes", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(createAccessPoint());

      await AccessPointController.getAccessPoint(request, response, next);

      expect(response.status.calledWith(200)).to.be.true;
      const sent = response.send.firstCall.args[0];
      expect(sent.id).to.equal("point-1");
      expect(sent).to.not.have.property("scanCode");
      expect(sent).to.not.have.property("previousScanCodes");
    });
  });

  describe("storeAccessPoint", () => {
    let storeAccessPoint;
    let getSupportedModes;

    beforeEach(() => {
      storeAccessPoint = sandbox
        .stub(AccessPointManager, "storeAccessPoint")
        .callsFake(async (accessPoint) => accessPoint);
      getSupportedModes = sandbox
        .stub(AccessInfoService, "getSupportedModes")
        .resolves(null);
    });

    describe("create", () => {
      it("creates an access point with a server-side id and scan code", async () => {
        request.body = { provider: "nuki", externalId: "lock-1" };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [created, tenantId] = storeAccessPoint.firstCall.args;
        expect(created.id).to.be.a("string").with.length.above(0);
        expect(created.scanCode).to.be.a("string").with.length.above(0);
        expect(created.previousScanCodes).to.deep.equal([]);
        expect(tenantId).to.equal("tenant-1");
        expect(response.status.calledWith(201)).to.be.true;
      });

      it("answers with the created access point without its scan codes", async () => {
        request.body = { provider: "nuki", externalId: "lock-1" };

        await AccessPointController.storeAccessPoint(request, response, next);

        const sent = response.send.firstCall.args[0];
        expect(sent.provider).to.equal("nuki");
        expect(sent).to.not.have.property("scanCode");
        expect(sent).to.not.have.property("previousScanCodes");
      });

      it("takes over all writable fields", async () => {
        request.body = {
          label: "Nebeneingang",
          type: "door",
          provider: "salto-ks",
          externalId: "lock-9",
          providerLocationId: "site-1",
          mode: "remote",
          config: { some: "value" },
          location: { coordinates: { type: "Point", points: [7.1, 51.2] } },
          validationRules: [{ type: "qrScan" }],
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [created] = storeAccessPoint.firstCall.args;
        expect(created).to.include({
          label: "Nebeneingang",
          type: "door",
          provider: "salto-ks",
          externalId: "lock-9",
          providerLocationId: "site-1",
          mode: "remote",
        });
        expect(created.config).to.deep.equal({ some: "value" });
        expect(created.location).to.deep.equal({
          coordinates: { type: "Point", points: [7.1, 51.2] },
        });
      });

      it("ignores a scan code sent by the client", async () => {
        request.body = {
          provider: "nuki",
          scanCode: "client-chosen-code",
          previousScanCodes: ["client-chosen-code"],
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [created] = storeAccessPoint.firstCall.args;
        expect(created.scanCode).to.not.equal("client-chosen-code");
        expect(created.previousScanCodes).to.deep.equal([]);
      });

      it("ignores a tenant sent by the client", async () => {
        request.body = { provider: "nuki", tenantId: "other-tenant" };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [created, tenantId] = storeAccessPoint.firstCall.args;
        expect(created.tenantId).to.equal("tenant-1");
        expect(tenantId).to.equal("tenant-1");
      });

      it("requires a qr scan when validationRules are omitted", async () => {
        request.body = { provider: "nuki" };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [created] = storeAccessPoint.firstCall.args;
        expect(created.validationRules).to.deep.equal([{ type: "qrScan" }]);
      });

      it("keeps an explicitly empty validationRules list empty", async () => {
        request.body = { provider: "nuki", validationRules: [] };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [created] = storeAccessPoint.firstCall.args;
        expect(created.validationRules).to.deep.equal([]);
      });

      it("hands validation errors to the error handler", async () => {
        request.body = { label: "Tür ohne Provider" };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.calledOnce).to.be.true;
        expect(next.firstCall.args[0]).to.be.instanceOf(ValidationError);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("accepts a rule together with the field it needs", async () => {
        request.body = {
          provider: "nuki",
          location: { display_address: "Rathaus" },
          validationRules: [{ type: TEST_GEO_RULE }],
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storeAccessPoint.calledOnce).to.be.true;
      });

      it("refuses a rule whose precondition the access point does not meet", async () => {
        request.body = {
          provider: "nuki",
          validationRules: [{ type: TEST_GEO_RULE }],
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.errors).to.deep.equal([
          {
            field: "validationRules",
            code: "precondition_failed",
            params: { ruleType: TEST_GEO_RULE, requires: ["location"] },
          },
        ]);
        expect(storeAccessPoint.called).to.be.false;
      });
    });

    describe("update", () => {
      let existing;

      beforeEach(() => {
        existing = createAccessPoint();
        sandbox.stub(AccessPointManager, "getAccessPoint").resolves(existing);
      });

      it("looks the access point up in the tenant of the path", async () => {
        request.body = { id: "point-1", label: "Neuer Name" };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(
          AccessPointManager.getAccessPoint.calledOnceWithExactly(
            "point-1",
            "tenant-1",
          ),
        ).to.be.true;
      });

      it("applies the submitted writable fields", async () => {
        request.body = {
          id: "point-1",
          label: "Neuer Name",
          provider: "salto-ks",
          externalId: "lock-42",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [updated] = storeAccessPoint.firstCall.args;
        expect(updated).to.include({
          label: "Neuer Name",
          provider: "salto-ks",
          externalId: "lock-42",
        });
        expect(response.status.calledWith(200)).to.be.true;
      });

      it("checks the preconditions against the state the update would leave behind", async () => {
        request.body = {
          id: "point-1",
          location: { display_address: "Rathaus" },
          validationRules: [{ type: TEST_GEO_RULE }],
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storeAccessPoint.calledOnce).to.be.true;
      });

      it("refuses an update that leaves a rule without its precondition", async () => {
        existing = createAccessPoint({
          location: { display_address: "Rathaus" },
          validationRules: [{ type: TEST_GEO_RULE }],
        });
        AccessPointManager.getAccessPoint.resolves(existing);
        request.body = { id: "point-1", location: null };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.firstCall.args[0]).to.be.instanceOf(ValidationError);
        expect(next.firstCall.args[0].errors[0]).to.deep.include({
          field: "validationRules",
          code: "precondition_failed",
        });
        expect(storeAccessPoint.called).to.be.false;
      });

      it("keeps the scan code when the lock is replaced", async () => {
        const scanCodeBefore = existing.scanCode;
        request.body = {
          id: "point-1",
          provider: "salto-ks",
          externalId: "lock-42",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [updated] = storeAccessPoint.firstCall.args;
        expect(updated.scanCode).to.equal(scanCodeBefore);
      });

      it("ignores a scan code sent by the client", async () => {
        const scanCodeBefore = existing.scanCode;
        request.body = {
          id: "point-1",
          scanCode: "client-chosen-code",
          previousScanCodes: ["client-chosen-code"],
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [updated] = storeAccessPoint.firstCall.args;
        expect(updated.scanCode).to.equal(scanCodeBefore);
        expect(updated.previousScanCodes).to.deep.equal([]);
      });

      it("keeps the validationRules when the field is omitted", async () => {
        request.body = { id: "point-1", label: "Neuer Name" };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [updated] = storeAccessPoint.firstCall.args;
        expect(updated.validationRules).to.deep.equal([{ type: "qrScan" }]);
      });

      it("clears the validationRules when an empty list is submitted", async () => {
        request.body = { id: "point-1", validationRules: [] };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [updated] = storeAccessPoint.firstCall.args;
        expect(updated.validationRules).to.deep.equal([]);
      });

      it("answers with the updated access point without its scan codes", async () => {
        request.body = { id: "point-1", label: "Neuer Name" };

        await AccessPointController.storeAccessPoint(request, response, next);

        const sent = response.send.firstCall.args[0];
        expect(sent.label).to.equal("Neuer Name");
        expect(sent).to.not.have.property("scanCode");
        expect(sent).to.not.have.property("previousScanCodes");
      });
    });

    describe("mode support", () => {
      it("refuses a mode the provider does not report as supported", async () => {
        getSupportedModes.resolves(["authorization"]);
        request.body = {
          provider: "nuki",
          externalId: "lock-1",
          mode: "remote",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.statusCode).to.equal(400);
        expect(error.errors).to.deep.equal([
          {
            field: "mode",
            code: "unsupported_mode",
            params: { mode: "remote", supportedModes: ["authorization"] },
          },
        ]);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("accepts a mode the provider reports as supported", async () => {
        getSupportedModes.resolves(["remote", "authorization", "both"]);
        request.body = {
          provider: "nuki",
          externalId: "lock-1",
          mode: "remote",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storeAccessPoint.calledOnce).to.be.true;
      });

      it("does not refuse when the provider reports no supported modes", async () => {
        getSupportedModes.resolves(null);
        request.body = {
          provider: "nuki",
          externalId: "lock-1",
          mode: "remote",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storeAccessPoint.calledOnce).to.be.true;
      });

      it("asks the provider about the access point the create would leave behind", async () => {
        request.body = {
          provider: "salto-ks",
          externalId: "lock-9",
          mode: "both",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [accessPoint, tenantId] = getSupportedModes.firstCall.args;
        expect(tenantId).to.equal("tenant-1");
        expect(accessPoint).to.include({
          provider: "salto-ks",
          externalId: "lock-9",
          mode: "both",
        });
      });

      it("checks the new hardware when provider and externalId change", async () => {
        sandbox
          .stub(AccessPointManager, "getAccessPoint")
          .resolves(createAccessPoint({ mode: "remote" }));
        getSupportedModes.resolves(["authorization"]);
        request.body = {
          id: "point-1",
          provider: "salto-ks",
          externalId: "lock-42",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [accessPoint, tenantId] = getSupportedModes.firstCall.args;
        expect(tenantId).to.equal("tenant-1");
        expect(accessPoint).to.include({
          provider: "salto-ks",
          externalId: "lock-42",
          mode: "remote",
        });
        expect(next.firstCall.args[0]).to.be.instanceOf(ValidationError);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("keeps the mode when the new hardware supports it", async () => {
        sandbox
          .stub(AccessPointManager, "getAccessPoint")
          .resolves(createAccessPoint({ mode: "remote" }));
        getSupportedModes.resolves(["remote", "authorization", "both"]);
        request.body = {
          id: "point-1",
          provider: "salto-ks",
          externalId: "lock-42",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        const [updated] = storeAccessPoint.firstCall.args;
        expect(updated.mode).to.equal("remote");
      });

      it("does not ask the provider about a body it already refused", async () => {
        request.body = {
          provider: "nuki",
          validationRules: [{ type: TEST_GEO_RULE }],
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.firstCall.args[0]).to.be.instanceOf(ValidationError);
        expect(getSupportedModes.called).to.be.false;
      });

      it("hands provider errors to the error handler", async () => {
        const failure = new Error("Nuki API Error");
        getSupportedModes.rejects(failure);
        request.body = { provider: "nuki", externalId: "lock-1" };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.calledOnceWithExactly(failure)).to.be.true;
        expect(storeAccessPoint.called).to.be.false;
      });
    });

    it("answers 404 when the tenant has no access point with that id", async () => {
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(null);
      request.body = { id: "unknown-point", label: "Neuer Name" };

      await AccessPointController.storeAccessPoint(request, response, next);

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(storeAccessPoint.called).to.be.false;
    });
  });

  describe("removeAccessPoint", () => {
    let removeAccessPoint;
    let detachAccessPoint;

    beforeEach(() => {
      request.params.id = "point-1";
      removeAccessPoint = sandbox
        .stub(AccessPointManager, "removeAccessPoint")
        .resolves();
      detachAccessPoint = sandbox
        .stub(BookableManager, "detachAccessPoint")
        .resolves();
    });

    it("answers 404 for an access point of another tenant", async () => {
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(null);

      await AccessPointController.removeAccessPoint(request, response, next);

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(removeAccessPoint.called).to.be.false;
    });

    it("deletes the access point of the tenant in the path", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(createAccessPoint());

      await AccessPointController.removeAccessPoint(request, response, next);

      expect(removeAccessPoint.calledOnceWithExactly("point-1", "tenant-1")).to
        .be.true;
      expect(response.sendStatus.calledWith(200)).to.be.true;
    });

    it("detaches the id from every bookable of the tenant", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(createAccessPoint());

      await AccessPointController.removeAccessPoint(request, response, next);

      expect(detachAccessPoint.calledOnceWithExactly("tenant-1", "point-1")).to
        .be.true;
    });

    it("detaches the id before the access point is gone", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(createAccessPoint());

      await AccessPointController.removeAccessPoint(request, response, next);

      expect(detachAccessPoint.calledBefore(removeAccessPoint)).to.be.true;
    });

    it("hands unexpected errors to the error handler", async () => {
      const failure = new Error("Database Error");
      sandbox.stub(AccessPointManager, "getAccessPoint").rejects(failure);

      await AccessPointController.removeAccessPoint(request, response, next);

      expect(next.calledOnceWithExactly(failure)).to.be.true;
    });
  });

  describe("getQrCode", () => {
    let render;

    beforeEach(() => {
      request.params.id = "point-1";
      render = sandbox.stub(AccessQrService, "render").resolves({
        format: "svg",
        contentType: "image/svg+xml",
        body: "<svg></svg>",
        filename: "access-point-point-1.svg",
      });
    });

    it("answers 404 for an access point of another tenant", async () => {
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(null);

      await AccessPointController.getQrCode(request, response, next);

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(render.called).to.be.false;
    });

    it("renders an svg by default", async () => {
      const accessPoint = createAccessPoint();
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(accessPoint);

      await AccessPointController.getQrCode(request, response, next);

      expect(render.calledOnceWithExactly(accessPoint, "svg")).to.be.true;
      expect(response.setHeader.calledWith("Content-Type", "image/svg+xml")).to
        .be.true;
      expect(response.status.calledWith(200)).to.be.true;
      expect(response.send.calledWith("<svg></svg>")).to.be.true;
    });

    it("passes the requested format through", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(createAccessPoint());
      request.query.format = "png";
      render.resolves({
        format: "png",
        contentType: "image/png",
        body: Buffer.from("png"),
        filename: "access-point-point-1.png",
      });

      await AccessPointController.getQrCode(request, response, next);

      expect(render.firstCall.args[1]).to.equal("png");
      expect(response.setHeader.calledWith("Content-Type", "image/png")).to.be
        .true;
    });

    it("answers 400 for an unsupported format", async () => {
      const getAccessPoint = sandbox.stub(AccessPointManager, "getAccessPoint");

      request.query.format = "bmp";

      await AccessPointController.getQrCode(request, response, next);

      expect(response.status.calledWith(400)).to.be.true;
      expect(getAccessPoint.called).to.be.false;
      expect(render.called).to.be.false;
    });

    it("hands unexpected errors to the error handler", async () => {
      const failure = new Error("Render Error");
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(createAccessPoint());
      render.rejects(failure);

      await AccessPointController.getQrCode(request, response, next);

      expect(next.calledOnceWithExactly(failure)).to.be.true;
    });
  });

  describe("rotateScanCode", () => {
    let storeAccessPoint;

    beforeEach(() => {
      request.params.id = "point-1";
      storeAccessPoint = sandbox
        .stub(AccessPointManager, "storeAccessPoint")
        .callsFake(async (accessPoint) => accessPoint);
    });

    it("answers 404 for an access point of another tenant", async () => {
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(null);

      await AccessPointController.rotateScanCode(request, response, next);

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(storeAccessPoint.called).to.be.false;
    });

    it("rotates the scan code and persists it for the tenant in the path", async () => {
      const accessPoint = createAccessPoint();
      const codeBefore = accessPoint.scanCode;
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(accessPoint);

      await AccessPointController.rotateScanCode(request, response, next);

      expect(accessPoint.scanCode).to.not.equal(codeBefore);
      expect(accessPoint.previousScanCodes[0]).to.equal(codeBefore);
      const [stored, tenantId] = storeAccessPoint.firstCall.args;
      expect(stored).to.equal(accessPoint);
      expect(tenantId).to.equal("tenant-1");
      expect(response.status.calledWith(200)).to.be.true;
    });

    it("returns neither the old nor the new scan code", async () => {
      const accessPoint = createAccessPoint();
      const codeBefore = accessPoint.scanCode;
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(accessPoint);

      await AccessPointController.rotateScanCode(request, response, next);

      const sent = response.send.firstCall.args[0];
      expect(sent).to.not.have.property("scanCode");
      expect(sent).to.not.have.property("previousScanCodes");
      const serialized = JSON.stringify(sent);
      expect(serialized).to.not.include(codeBefore);
      expect(serialized).to.not.include(accessPoint.scanCode);
    });

    it("hands unexpected errors to the error handler", async () => {
      const failure = new Error("Database Error");
      sandbox.stub(AccessPointManager, "getAccessPoint").rejects(failure);

      await AccessPointController.rotateScanCode(request, response, next);

      expect(next.calledOnceWithExactly(failure)).to.be.true;
    });
  });

  describe("getLocationPrefill", () => {
    let getLocationPrefill;
    let storeAccessPoint;

    beforeEach(() => {
      request.params.id = "point-1";
      getLocationPrefill = sandbox
        .stub(AccessLocationService, "getLocationPrefill")
        .resolves({ coordinates: { type: "Point", points: [7.1, 51.2] } });
      storeAccessPoint = sandbox.stub(AccessPointManager, "storeAccessPoint");
    });

    it("answers 404 for an access point of another tenant", async () => {
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(null);

      await AccessPointController.getLocationPrefill(request, response, next);

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(getLocationPrefill.called).to.be.false;
    });

    it("sends the location the provider reports", async () => {
      const accessPoint = createAccessPoint();
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(accessPoint);

      await AccessPointController.getLocationPrefill(request, response, next);

      expect(getLocationPrefill.calledOnceWithExactly(accessPoint, "tenant-1"))
        .to.be.true;
      expect(response.status.calledWith(200)).to.be.true;
      expect(response.json.firstCall.args[0]).to.deep.equal({
        coordinates: { type: "Point", points: [7.1, 51.2] },
      });
    });

    it("sends null for a provider that knows no location", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(createAccessPoint({ provider: "salto-ks" }));
      getLocationPrefill.resolves(null);

      await AccessPointController.getLocationPrefill(request, response, next);

      expect(response.status.calledWith(200)).to.be.true;
      expect(response.json.calledOnceWithExactly(null)).to.be.true;
    });

    it("writes nothing to the access point, adopting the location is a PUT", async () => {
      const accessPoint = createAccessPoint();
      const locationBefore = accessPoint.location;
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(accessPoint);

      await AccessPointController.getLocationPrefill(request, response, next);

      expect(storeAccessPoint.called).to.be.false;
      expect(accessPoint.location).to.equal(locationBefore);
    });

    it("hands unexpected errors to the error handler", async () => {
      const failure = new Error("Nuki API Error");
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(createAccessPoint());
      getLocationPrefill.rejects(failure);

      await AccessPointController.getLocationPrefill(request, response, next);

      expect(next.calledOnceWithExactly(failure)).to.be.true;
    });
  });
});
