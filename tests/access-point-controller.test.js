const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

const { AccessPoint } = require("../src/commons/entities/access/access-point");
const { ValidationError } = require("../src/errors/ValidationError");
const { BaseError, NotFoundError } = require("../src/errors/BaseError");
const { TEST_GEO_RULE } = require("./helpers/test-validation-rule");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const LockerSystemMutex = require("../src/commons/services/access/locker-system-mutex");
const LockerSystemRedistribution = require("../src/commons/services/access/locker-system-redistribution");
const { Booking } = require("../src/commons/entities/booking/booking");
const SaltoKsAccessProvider = require("../src/commons/services/access/providers/salto-ks-access-provider");
const OpenLockerAccessProvider = require("../src/commons/services/access/providers/open-locker-access-provider");
const {
  registerAccessProvider,
} = require("../src/commons/services/access/providers/access-provider-registry");
const {
  FakeSaltoKsApiClient,
  FAKE_SITE_ID,
} = require("./helpers/fake-salto-ks-api-client");
const {
  FakeOpenLockerApiClient,
  brokenOpenLockerApiClient,
  openLockerHttpError,
  COMPARTMENT_ID,
  OTHER_COMPARTMENT_ID,
  SECOND_COMPARTMENT_ID,
  LOCKER_BANK_ID,
  SECOND_LOCKER_BANK_ID,
} = require("./helpers/fake-open-locker-api-client");
const {
  SALTO_LOCK_ID,
  SALTO_IQ_ID,
  saltoLock,
  saltoIq,
  tenantWithSaltoApp,
} = require("./helpers/access-provider-fixtures");
const {
  installInMemoryLockerSystemHolds,
} = require("./helpers/in-memory-locker-system-holds");

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
 * An Open Locker Anlage with its own list: its own code is never printed and
 * never rotated, only the codes of its Fächer are (tickets#1046).
 */
function createOwnListAnlage() {
  return createAccessPoint({
    id: "point-1",
    provider: "open-locker",
    type: "locker",
    externalId: null,
    label: "Fahrradgarage",
    config: {
      compartments: [
        {
          id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
          number: 3,
          lockerBank: { id: "bank-1", name: "Labor Fachbank 1" },
          outOfService: false,
          scanCode: "code-fach-3",
          previousScanCodes: [],
        },
      ],
    },
  });
}

function listedAccessPoint(supportedModes) {
  return {
    id: "lock-1",
    provider: "nuki",
    externalId: "lock-1",
    supportedModes,
  };
}

/** The tenant's Open Locker compartment as its listing names it. */
function listedCompartment() {
  return {
    id: COMPARTMENT_ID,
    provider: "open-locker",
    externalId: COMPARTMENT_ID,
    supportedModes: ["remote"],
  };
}

/**
 * A lock as Nuki lists it: the device type sits in the provider's raw
 * `metadata`. No `supportedModes`, so the mode check passes and the
 * Öffnungsart is the only thing under test.
 */
function listedNukiLock(type) {
  return {
    id: "lock-1",
    provider: "nuki",
    externalId: "lock-1",
    metadata: { type },
  };
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
    let findListedAccessPoint;

    beforeEach(() => {
      storeAccessPoint = sandbox
        .stub(AccessPointManager, "storeAccessPoint")
        .callsFake(async (accessPoint) => accessPoint);
      findListedAccessPoint = sandbox
        .stub(AccessInfoService, "findListedAccessPoint")
        .resolves(null);
      // The tenant's other access points, read where a Fach may already be
      // held by one of them (tickets#1037).
      sandbox.stub(AccessPointManager, "getAccessPoints").resolves([]);
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

      it("requires no qr scan at an Open Locker compartment when validationRules are omitted", async () => {
        findListedAccessPoint.resolves(listedCompartment());
        request.body = {
          provider: "open-locker",
          type: "door",
          mode: "remote",
          externalId: COMPARTMENT_ID,
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [created] = storeAccessPoint.firstCall.args;
        expect(created.validationRules).to.deep.equal([]);
      });

      it("requires a qr scan at an Open Locker compartment that configures one", async () => {
        findListedAccessPoint.resolves(listedCompartment());
        request.body = {
          provider: "open-locker",
          type: "door",
          mode: "remote",
          externalId: COMPARTMENT_ID,
          validationRules: [{ type: "qrScan" }],
        };

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
          location: {
            display_address: "Rathaus",
            coordinates: { type: "Point", points: [7.1, 51.2] },
          },
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
          mode: "remote",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [updated] = storeAccessPoint.firstCall.args;
        expect(updated).to.include({
          label: "Neuer Name",
          provider: "salto-ks",
          externalId: "lock-42",
          mode: "remote",
        });
        expect(response.status.calledWith(200)).to.be.true;
      });

      it("checks the preconditions against the state the update would leave behind", async () => {
        request.body = {
          id: "point-1",
          location: {
            display_address: "Rathaus",
            coordinates: { type: "Point", points: [7.1, 51.2] },
          },
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
          mode: "remote",
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

    // tickets#1045: an Anlage takes a location the way a door does - only
    // kept, for the start view of the map.
    describe("the location of an Anlage", () => {
      const LOCATION = {
        display_address: "Bahnhofstraße 1, 03172 Guben",
        coordinates: { type: "Point", points: [14.7161, 51.9512] },
      };

      function anlage(overrides = {}) {
        return {
          type: "locker",
          provider: "pareva",
          externalId: "plant-1",
          mode: "remote",
          validationRules: [],
          ...overrides,
        };
      }

      it("stores the location of a new Anlage", async () => {
        request.body = anlage({ location: LOCATION });

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        const [created] = storeAccessPoint.firstCall.args;
        expect(created.type).to.equal("locker");
        expect(created.location).to.deep.equal(LOCATION);
      });

      describe("on an update", () => {
        beforeEach(() => {
          sandbox
            .stub(AccessPointManager, "getAccessPoint")
            .resolves(createAccessPoint(anlage({ location: { ...LOCATION } })));
        });

        it("stores a changed location", async () => {
          const moved = {
            display_address: "Gasstraße 4, 03172 Guben",
            coordinates: { type: "Point", points: [14.714485, 51.950438] },
          };
          request.body = { id: "point-1", ...anlage({ location: moved }) };

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          const [updated] = storeAccessPoint.firstCall.args;
          expect(updated.location).to.deep.equal(moved);
        });

        it("clears the location when none is submitted", async () => {
          request.body = { id: "point-1", ...anlage({ location: null }) };

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          const [updated] = storeAccessPoint.firstCall.args;
          expect(updated.location).to.equal(null);
        });
      });
    });

    describe("mode support", () => {
      it("refuses a mode the provider does not report as supported", async () => {
        findListedAccessPoint.resolves(listedAccessPoint(["authorization"]));
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

      it("does not refuse when the lock can do nothing right now", async () => {
        findListedAccessPoint.resolves(listedAccessPoint([]));
        request.body = {
          provider: "nuki",
          externalId: "lock-1",
          mode: "authorization",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storeAccessPoint.calledOnce).to.be.true;
      });

      it("accepts a mode the provider reports as supported", async () => {
        findListedAccessPoint.resolves(
          listedAccessPoint(["remote", "authorization", "both"]),
        );
        request.body = {
          provider: "nuki",
          externalId: "lock-1",
          mode: "remote",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storeAccessPoint.calledOnce).to.be.true;
      });

      it("does not refuse when the provider does not list the access point", async () => {
        findListedAccessPoint.resolves(null);
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
          mode: "remote",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [accessPoint, tenantId] = findListedAccessPoint.firstCall.args;
        expect(tenantId).to.equal("tenant-1");
        expect(accessPoint).to.include({
          provider: "salto-ks",
          externalId: "lock-9",
          mode: "remote",
        });
      });

      it("checks the new hardware when provider and externalId change", async () => {
        sandbox
          .stub(AccessPointManager, "getAccessPoint")
          .resolves(createAccessPoint({ mode: "remote" }));
        findListedAccessPoint.resolves(listedAccessPoint(["authorization"]));
        request.body = {
          id: "point-1",
          provider: "salto-ks",
          externalId: "lock-42",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const [accessPoint, tenantId] = findListedAccessPoint.firstCall.args;
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
        findListedAccessPoint.resolves(
          listedAccessPoint(["remote", "authorization", "both"]),
        );
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
        expect(findListedAccessPoint.called).to.be.false;
      });

      it("does not refuse when the listed entry names no supported modes", async () => {
        findListedAccessPoint.resolves(listedAccessPoint(undefined));
        request.body = {
          provider: "nuki",
          externalId: "lock-1",
          mode: "remote",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storeAccessPoint.calledOnce).to.be.true;
      });
    });

    /**
     * A Salto door opens remotely or not at all (tickets#499), and that holds
     * without asking Salto (tickets#311): while the tenant's Salto KS
     * application is not active, and for a lock Salto does not list. The
     * provider runs for real, over the fake Connect API.
     */
    describe("Salto KS mode", () => {
      after(() => {
        registerAccessProvider("salto-ks", SaltoKsAccessProvider);
      });

      beforeEach(() => {
        findListedAccessPoint.restore();
        installSalto(saltoIq());
      });

      /**
       * Salto KS over the fake Connect API, with one lock on the given IQ.
       *
       * @returns {FakeSaltoKsApiClient} The client the provider asks
       */
      function installSalto(iq) {
        const saltoClient = new FakeSaltoKsApiClient({
          locks: [
            saltoLock({ iq: { id: iq.id, otp_enabled: iq.otp_enabled } }),
          ],
          iqs: [iq],
        });
        registerAccessProvider(
          "salto-ks",
          class extends SaltoKsAccessProvider {
            constructor() {
              super({ client: saltoClient });
            }
          },
        );
        return saltoClient;
      }

      function saltoApp(active, iqActivations = []) {
        const tenant = tenantWithSaltoApp();
        tenant.applications[0].active = active;
        tenant.applications[0].iqActivations = iqActivations;
        return tenant;
      }

      ["authorization", "both"].forEach((mode) => {
        it(`refuses ${mode} at a Salto door while the tenant's Salto KS application is not active`, async () => {
          sandbox.stub(TenantManager, "getTenant").resolves(saltoApp(false));
          request.body = {
            provider: "salto-ks",
            externalId: SALTO_LOCK_ID,
            mode,
          };

          await AccessPointController.storeAccessPoint(request, response, next);

          const error = next.firstCall.args[0];
          expect(error).to.be.instanceOf(ValidationError);
          expect(error.statusCode).to.equal(400);
          expect(error.errors).to.deep.equal([
            {
              field: "mode",
              code: "unsupported_mode",
              params: { mode, supportedModes: ["remote"] },
            },
          ]);
          expect(storeAccessPoint.called).to.be.false;
        });

        it(`refuses ${mode} at a Salto door Salto does not list`, async () => {
          sandbox.stub(TenantManager, "getTenant").resolves(saltoApp(true));
          request.body = {
            provider: "salto-ks",
            externalId: "lock-unknown-to-salto",
            mode,
          };

          await AccessPointController.storeAccessPoint(request, response, next);

          const error = next.firstCall.args[0];
          expect(error).to.be.instanceOf(ValidationError);
          expect(error.errors[0]).to.include({
            field: "mode",
            code: "unsupported_mode",
          });
          expect(storeAccessPoint.called).to.be.false;
        });
      });

      /**
       * The rule needs no listing, so it holds when Salto cannot be asked
       * (tickets#311, tickets#570): a 400 for the mode, not a 503 for Salto.
       */
      describe("Salto not reachable", () => {
        beforeEach(() => {
          const saltoClient = installSalto(saltoIq());
          sandbox.stub(saltoClient, "_send").rejects(
            Object.assign(new Error("connect ECONNREFUSED"), {
              code: "ECONNREFUSED",
            }),
          );
          sandbox.stub(TenantManager, "getTenant").resolves(saltoApp(true));
        });

        ["authorization", "both"].forEach((mode) => {
          it(`refuses ${mode} at a new Salto door with 400 unsupported_mode`, async () => {
            request.body = {
              provider: "salto-ks",
              externalId: SALTO_LOCK_ID,
              mode,
            };

            await AccessPointController.storeAccessPoint(
              request,
              response,
              next,
            );

            const error = next.firstCall.args[0];
            expect(error).to.be.instanceOf(ValidationError);
            expect(error.statusCode).to.equal(400);
            expect(error.errors).to.deep.equal([
              {
                field: "mode",
                code: "unsupported_mode",
                params: { mode, supportedModes: ["remote"] },
              },
            ]);
            expect(storeAccessPoint.called).to.be.false;
          });
        });

        it("refuses a rename of a Salto door still stored with both with 400 unsupported_mode", async () => {
          sandbox.stub(AccessPointManager, "getAccessPoint").resolves(
            createAccessPoint({
              provider: "salto-ks",
              externalId: SALTO_LOCK_ID,
              mode: "both",
            }),
          );
          request.body = { id: "point-1", label: "Labortür" };

          await AccessPointController.storeAccessPoint(request, response, next);

          const error = next.firstCall.args[0];
          expect(error).to.be.instanceOf(ValidationError);
          expect(error.errors[0]).to.include({ code: "unsupported_mode" });
          expect(storeAccessPoint.called).to.be.false;
        });

        it("answers 503 access_provider_unreachable for remote, storing nothing", async () => {
          request.body = {
            provider: "salto-ks",
            externalId: SALTO_LOCK_ID,
            mode: "remote",
          };

          await AccessPointController.storeAccessPoint(request, response, next);

          const error = next.firstCall.args[0];
          expect(error.statusCode).to.equal(503);
          expect(error.code).to.equal("access_provider_unreachable");
          expect(storeAccessPoint.called).to.be.false;
        });
      });

      it("refuses a rename of a Salto door still stored with both", async () => {
        sandbox.stub(TenantManager, "getTenant").resolves(saltoApp(false));
        sandbox.stub(AccessPointManager, "getAccessPoint").resolves(
          createAccessPoint({
            provider: "salto-ks",
            externalId: SALTO_LOCK_ID,
            mode: "both",
          }),
        );
        request.body = { id: "point-1", label: "Labortür" };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.firstCall.args[0]).to.be.instanceOf(ValidationError);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("stores remote at a Salto door while the tenant's Salto KS application is not active", async () => {
        sandbox.stub(TenantManager, "getTenant").resolves(saltoApp(false));
        request.body = {
          provider: "salto-ks",
          externalId: SALTO_LOCK_ID,
          mode: "remote",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        const [created] = storeAccessPoint.firstCall.args;
        expect(created.mode).to.equal("remote");
      });

      it("stores remote at a Salto door Salto does not list", async () => {
        sandbox.stub(TenantManager, "getTenant").resolves(saltoApp(true));
        request.body = {
          provider: "salto-ks",
          externalId: "lock-unknown-to-salto",
          mode: "remote",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storeAccessPoint.calledOnce).to.be.true;
      });

      /**
       * A lock whose IQ is not activated lists no modes: it can do nothing
       * right now, which is no mode it can never do (tickets#570). It opens
       * once the IQ is activated; until then opening fails on its own.
       */
      describe("IQ not activated", () => {
        beforeEach(() => {
          installSalto(saltoIq({ otp_enabled: true }));
        });

        it("stores remote at a Salto door whose IQ was never activated", async () => {
          sandbox.stub(TenantManager, "getTenant").resolves(saltoApp(true));
          request.body = {
            provider: "salto-ks",
            externalId: SALTO_LOCK_ID,
            mode: "remote",
          };

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          const [created] = storeAccessPoint.firstCall.args;
          expect(created.mode).to.equal("remote");
          expect(response.status.calledWith(201)).to.be.true;
        });

        it("renames a Salto door whose IQ requires re-activation", async () => {
          sandbox.stub(TenantManager, "getTenant").resolves(
            saltoApp(true, [
              {
                iqId: SALTO_IQ_ID,
                siteId: FAKE_SITE_ID,
                username: "system-user@example.test",
                environment: "accept",
                state: "reactivation_required",
                failureCount: 0,
                blockedUntil: null,
              },
            ]),
          );
          sandbox.stub(AccessPointManager, "getAccessPoint").resolves(
            createAccessPoint({
              provider: "salto-ks",
              externalId: SALTO_LOCK_ID,
              mode: "remote",
            }),
          );
          request.body = { id: "point-1", label: "Labortür" };

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          const [updated] = storeAccessPoint.firstCall.args;
          expect(updated).to.include({ label: "Labortür", mode: "remote" });
          expect(response.status.calledWith(200)).to.be.true;
        });

        ["authorization", "both"].forEach((mode) => {
          it(`still refuses ${mode} at a Salto door whose IQ was never activated`, async () => {
            sandbox.stub(TenantManager, "getTenant").resolves(saltoApp(true));
            request.body = {
              provider: "salto-ks",
              externalId: SALTO_LOCK_ID,
              mode,
            };

            await AccessPointController.storeAccessPoint(
              request,
              response,
              next,
            );

            const error = next.firstCall.args[0];
            expect(error).to.be.instanceOf(ValidationError);
            expect(error.errors).to.deep.equal([
              {
                field: "mode",
                code: "unsupported_mode",
                params: { mode, supportedModes: ["remote"] },
              },
            ]);
            expect(storeAccessPoint.called).to.be.false;
          });
        });
      });
    });

    /**
     * An Open Locker compartment is stored only where the tenant's technical
     * account holds a permission on it - where its listing names it - so no
     * compartment is set up that never opens (tickets#971). Open Locker runs
     * over the fake instance, where a neighbour's account holds the other
     * compartment.
     */
    describe("Open Locker compartment access", () => {
      let openLocker;

      after(() => {
        registerAccessProvider("open-locker", OpenLockerAccessProvider);
      });

      beforeEach(() => {
        findListedAccessPoint.restore();
        openLocker = new FakeOpenLockerApiClient();
        registerAccessProvider(
          "open-locker",
          class extends OpenLockerAccessProvider {
            constructor() {
              super({ client: openLocker });
            }
          },
        );
      });

      function compartment(externalId) {
        return {
          provider: "open-locker",
          type: "door",
          mode: "remote",
          label: "Fach",
          externalId,
        };
      }

      it("stores a compartment the account holds a permission on", async () => {
        request.body = compartment(COMPARTMENT_ID);

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storeAccessPoint.calledOnce).to.be.true;
        expect(response.status.calledWith(201)).to.be.true;
      });

      it("refuses the compartment of another tenant's account", async () => {
        request.body = compartment(OTHER_COMPARTMENT_ID);

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.statusCode).to.equal(400);
        expect(error.errors).to.deep.equal([
          {
            field: "externalId",
            code: "compartment_not_accessible",
            params: { externalId: OTHER_COMPARTMENT_ID },
          },
        ]);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("refuses a compartment without a UUID, without asking Open Locker", async () => {
        request.body = compartment("");

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.statusCode).to.equal(400);
        expect(error.errors).to.deep.equal([
          { field: "externalId", code: "required" },
        ]);
        expect(storeAccessPoint.called).to.be.false;
        expect(openLocker.requests).to.deep.equal([]);
      });

      it("refuses to store a compartment again once the account lost its permission on it", async () => {
        sandbox.stub(AccessPointManager, "getAccessPoint").resolves(
          createAccessPoint({
            ...compartment(COMPARTMENT_ID),
            validationRules: [],
          }),
        );
        openLocker.revokePermission(COMPARTMENT_ID);
        request.body = { id: "point-1", label: "Fach 1" };

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.errors[0].code).to.equal("compartment_not_accessible");
        expect(storeAccessPoint.called).to.be.false;
      });
    });

    /**
     * An Open Locker Schließfachanlage is a `locker` in mode `remote` that
     * carries its own list of Fächer, picked from Open Locker's listing
     * (tickets#1037). The save copies each Fach's Schließfachschrank and
     * number from the listing, and keeps one Fach in at most one Anlage and
     * out of the fixed Fächer, across the tenant.
     */
    describe("Open Locker locker system", () => {
      let openLocker;
      let tenantAccessPoints;
      let bookingsHolding;

      after(() => {
        registerAccessProvider("open-locker", OpenLockerAccessProvider);
      });

      beforeEach(() => {
        findListedAccessPoint.restore();
        openLocker = new FakeOpenLockerApiClient();
        registerOpenLocker(() => openLocker);
        tenantAccessPoints = [];
        AccessPointManager.getAccessPoints.callsFake(
          async () => tenantAccessPoints,
        );
        // A Fach leaving the Anlage moves the bookings at it, under the
        // mutex of the Anlage (tickets#1043): none hang at it here.
        bookingsHolding = [];
        sandbox
          .stub(BookingManager, "getBookingsHoldingCompartments")
          .callsFake(async () => bookingsHolding);
        sandbox.stub(BookingManager, "storeBooking").callsFake(async (b) => b);
        sandbox.stub(BookableManager, "getBookablesByIds").resolves([]);
        sandbox
          .stub(LockerSystemMutex, "hold")
          .callsFake(async (lockerSystem, work) => work());
      });

      function registerOpenLocker(client) {
        registerAccessProvider(
          "open-locker",
          class extends OpenLockerAccessProvider {
            constructor() {
              super({ client: client() });
            }
          },
        );
      }

      function lockerSystem(compartments, overrides = {}) {
        return {
          provider: "open-locker",
          type: "locker",
          mode: "remote",
          label: "Fahrradgarage",
          config: { compartments },
          ...overrides,
        };
      }

      function storedCompartments() {
        return storeAccessPoint.firstCall.args[0].config.compartments;
      }

      /** The stored Fächer without their scan codes (tickets#1055). */
      function storedCompartmentsWithoutScanCodes() {
        return storedCompartments().map((compartment) => {
          const rest = { ...compartment };
          delete rest.scanCode;
          delete rest.previousScanCodes;
          return rest;
        });
      }

      it("stores the picked Fächer with their Schließfachschrank and number from Open Locker's listing", async () => {
        request.body = lockerSystem([
          { id: COMPARTMENT_ID },
          { id: SECOND_COMPARTMENT_ID, outOfService: true },
        ]);

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(response.status.calledWith(201)).to.be.true;
        expect(storedCompartmentsWithoutScanCodes()).to.deep.equal([
          {
            id: COMPARTMENT_ID,
            number: 1,
            lockerBank: { id: LOCKER_BANK_ID, name: "Labor Fachbank 1" },
            outOfService: false,
          },
          {
            id: SECOND_COMPARTMENT_ID,
            number: 3,
            lockerBank: {
              id: SECOND_LOCKER_BANK_ID,
              name: "Quartiersschrank Hafen",
            },
            outOfService: true,
          },
        ]);
      });

      // tickets#1045: the location is the Anlage's, not one per Fach.
      it("stores the location of the Anlage along with its Fächer", async () => {
        const location = {
          display_address: "Gasstraße 4, 03172 Guben",
          coordinates: { type: "Point", points: [14.714485, 51.950438] },
        };
        request.body = lockerSystem([{ id: COMPARTMENT_ID }], { location });

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storeAccessPoint.firstCall.args[0].location).to.deep.equal(
          location,
        );
      });

      it("takes a rename in Open Locker over on the next save of the Anlage", async () => {
        sandbox.stub(AccessPointManager, "getAccessPoint").resolves(
          createAccessPoint({
            ...lockerSystem([
              {
                id: COMPARTMENT_ID,
                number: 1,
                lockerBank: { id: LOCKER_BANK_ID, name: "Alter Name" },
                outOfService: false,
              },
            ]),
            externalId: "",
            validationRules: [],
          }),
        );
        openLocker.lockerBanks[0].name = "Labor Fachbank Nord";
        request.body = { id: "point-1", label: "Fahrradgarage Nord" };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storedCompartments()[0].lockerBank).to.deep.equal({
          id: LOCKER_BANK_ID,
          name: "Labor Fachbank Nord",
        });
      });

      it("needs no UUID of its own and asks Open Locker only for the listing", async () => {
        request.body = lockerSystem([{ id: COMPARTMENT_ID }], {
          externalId: "",
        });

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(
          openLocker.requests.filter((r) => r !== "POST /api/login"),
        ).to.deep.equal(["GET /api/compartments/accessible"]);
      });

      it("refuses a Fach the technical account holds no permission on, at that Fach", async () => {
        request.body = lockerSystem([
          { id: COMPARTMENT_ID },
          { id: OTHER_COMPARTMENT_ID },
        ]);

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.errors).to.deep.equal([
          {
            field: "config.compartments.1",
            code: "compartment_not_accessible",
            params: { compartmentId: OTHER_COMPARTMENT_ID },
          },
        ]);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("refuses a Fach named twice in the list", async () => {
        request.body = lockerSystem([
          { id: COMPARTMENT_ID },
          { id: COMPARTMENT_ID },
        ]);

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.firstCall.args[0].errors).to.deep.equal([
          {
            field: "config.compartments.1",
            code: "duplicate_compartment",
            params: { compartmentId: COMPARTMENT_ID },
          },
        ]);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("refuses an Anlage without its list of Fächer", async () => {
        request.body = lockerSystem(undefined, { config: {} });

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.firstCall.args[0].errors).to.deep.equal([
          { field: "config.compartments", code: "required" },
        ]);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("refuses an Anlage in another mode than remote", async () => {
        request.body = lockerSystem([], { mode: "authorization" });

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.firstCall.args[0].errors).to.deep.equal([
          {
            field: "mode",
            code: "unsupported_mode",
            params: { mode: "authorization", supportedModes: ["remote"] },
          },
        ]);
      });

      it("stores the Fächer as the request names them while the tenant's Open Locker is not active", async () => {
        registerAccessProvider("open-locker", OpenLockerAccessProvider);
        sandbox.stub(TenantManager, "getTenant").resolves({
          id: "tenant-1",
          applications: [{ type: "access", id: "open-locker", active: false }],
        });
        const named = {
          id: OTHER_COMPARTMENT_ID,
          number: 2,
          lockerBank: { id: LOCKER_BANK_ID, name: "Labor Fachbank 1" },
          outOfService: true,
        };
        request.body = lockerSystem([named]);

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storedCompartmentsWithoutScanCodes()).to.deep.equal([named]);
      });

      it("answers 503 and stores nothing when Open Locker cannot be reached", async () => {
        registerOpenLocker(() =>
          brokenOpenLockerApiClient(openLockerHttpError(500)),
        );
        request.body = lockerSystem([{ id: COMPARTMENT_ID }]);

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.firstCall.args[0].code).to.equal(
          "access_provider_unreachable",
        );
        expect(storeAccessPoint.called).to.be.false;
      });

      it("refuses a Fach that already stands in another Anlage of the tenant", async () => {
        tenantAccessPoints = [
          createAccessPoint({
            id: "anlage-2",
            ...lockerSystem([{ id: SECOND_COMPARTMENT_ID }]),
            label: "Paketstation",
          }),
        ];
        request.body = lockerSystem([
          { id: COMPARTMENT_ID },
          { id: SECOND_COMPARTMENT_ID },
        ]);

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.errors).to.deep.equal([
          {
            field: "config.compartments.1",
            code: "compartment_in_locker_system",
            params: {
              compartmentId: SECOND_COMPARTMENT_ID,
              accessPointId: "anlage-2",
              label: "Paketstation",
            },
          },
        ]);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("refuses a Fach that is a fixed Fach of the tenant", async () => {
        tenantAccessPoints = [
          createAccessPoint({
            id: "fach-1",
            provider: "open-locker",
            type: "door",
            mode: "remote",
            externalId: COMPARTMENT_ID,
            label: "Labor Fachbank 1 · Fach 1",
          }),
        ];
        request.body = lockerSystem([{ id: COMPARTMENT_ID }]);

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.firstCall.args[0].errors).to.deep.equal([
          {
            field: "config.compartments.0",
            code: "compartment_is_fixed",
            params: {
              compartmentId: COMPARTMENT_ID,
              accessPointId: "fach-1",
              label: "Labor Fachbank 1 · Fach 1",
            },
          },
        ]);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("checks the Fächer also while the tenant's Open Locker is not active", async () => {
        registerAccessProvider("open-locker", OpenLockerAccessProvider);
        sandbox.stub(TenantManager, "getTenant").resolves({
          id: "tenant-1",
          applications: [],
        });
        tenantAccessPoints = [
          createAccessPoint({
            id: "anlage-2",
            ...lockerSystem([{ id: COMPARTMENT_ID }]),
          }),
        ];
        request.body = lockerSystem([{ id: COMPARTMENT_ID }]);

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.firstCall.args[0].errors[0].code).to.equal(
          "compartment_in_locker_system",
        );
      });

      it("lets an Anlage keep its own Fächer on an update", async () => {
        const stored = createAccessPoint({
          id: "anlage-1",
          ...lockerSystem([{ id: COMPARTMENT_ID }]),
          externalId: "",
          validationRules: [],
        });
        tenantAccessPoints = [stored];
        sandbox.stub(AccessPointManager, "getAccessPoint").resolves(stored);
        request.body = {
          id: "anlage-1",
          config: {
            compartments: [{ id: COMPARTMENT_ID, outOfService: true }],
          },
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storedCompartments()[0].outOfService).to.be.true;
      });

      it("refuses a fixed Fach that already stands in an Anlage", async () => {
        tenantAccessPoints = [
          createAccessPoint({
            id: "anlage-2",
            ...lockerSystem([{ id: COMPARTMENT_ID }]),
            label: "Paketstation",
          }),
        ];
        request.body = {
          provider: "open-locker",
          type: "door",
          mode: "remote",
          label: "Fach 1",
          externalId: COMPARTMENT_ID,
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.firstCall.args[0].errors).to.deep.equal([
          {
            field: "externalId",
            code: "compartment_in_locker_system",
            params: {
              compartmentId: COMPARTMENT_ID,
              accessPointId: "anlage-2",
              label: "Paketstation",
            },
          },
        ]);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("refuses a list of Fächer on an Anlage whose provider assigns the Fach itself", async () => {
        sandbox.stub(AccessInfoService, "findListedAccessPoint").resolves(null);
        request.body = {
          provider: "ifbs",
          type: "locker",
          mode: "remote",
          externalId: "location-1",
          config: { compartments: [{ id: COMPARTMENT_ID }] },
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.firstCall.args[0].errors).to.deep.equal([
          {
            field: "config.compartments",
            code: "unsupported_by_provider",
            params: { provider: "ifbs" },
          },
        ]);
        expect(storeAccessPoint.called).to.be.false;
      });

      /**
       * Every Fach of an Anlage with its own list carries a scan code of its
       * own (tickets#1055): the server mints it on the save, a stored Fach
       * keeps it, and no client writes or reads it.
       */
      describe("the scan code of a Fach", () => {
        const SCAN_CODE = /^[A-Za-z0-9_-]{32}$/;

        it("gives every Fach of a new Anlage a code of its own, minted like a door's", async () => {
          request.body = lockerSystem([
            { id: COMPARTMENT_ID },
            { id: SECOND_COMPARTMENT_ID },
          ]);

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          const [first, second] = storedCompartments();
          expect(first.scanCode).to.match(SCAN_CODE);
          expect(second.scanCode).to.match(SCAN_CODE);
          expect(first.scanCode).to.not.equal(second.scanCode);
          expect(first.previousScanCodes).to.deep.equal([]);
          expect(second.previousScanCodes).to.deep.equal([]);
        });

        /** The Anlage as stored, its Fach with a code and an earlier one. */
        function storedAnlage(compartmentOverrides = {}) {
          const stored = createAccessPoint({
            id: "anlage-1",
            ...lockerSystem([
              {
                id: COMPARTMENT_ID,
                number: 1,
                lockerBank: { id: LOCKER_BANK_ID, name: "Labor Fachbank 1" },
                outOfService: false,
                scanCode: "code-fach-1",
                previousScanCodes: ["earlier-code-fach-1"],
                ...compartmentOverrides,
              },
            ]),
            externalId: "",
            validationRules: [],
          });
          // Each read answers a fresh row, as the manager does.
          sandbox
            .stub(AccessPointManager, "getAccessPoint")
            .callsFake(
              async () =>
                new AccessPoint(
                  JSON.parse(JSON.stringify(stored.toDocument())),
                ),
            );
          return stored;
        }

        const byId = (id) =>
          storedCompartments().find((compartment) => compartment.id === id);

        it("lets a stored Fach keep its code and earlier codes, and gives a newly picked one a fresh code", async () => {
          storedAnlage();
          request.body = {
            id: "anlage-1",
            config: {
              compartments: [
                { id: SECOND_COMPARTMENT_ID },
                { id: COMPARTMENT_ID },
              ],
            },
          };

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          expect(byId(COMPARTMENT_ID)).to.include({
            scanCode: "code-fach-1",
          });
          expect(byId(COMPARTMENT_ID).previousScanCodes).to.deep.equal([
            "earlier-code-fach-1",
          ]);
          expect(byId(SECOND_COMPARTMENT_ID).scanCode).to.match(SCAN_CODE);
          expect(byId(SECOND_COMPARTMENT_ID).previousScanCodes).to.deep.equal(
            [],
          );
        });

        it("keeps the codes on a save that names no Fächer", async () => {
          storedAnlage();
          request.body = { id: "anlage-1", label: "Fahrradgarage Nord" };

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          expect(byId(COMPARTMENT_ID).scanCode).to.equal("code-fach-1");
        });

        it("keeps the codes while the tenant's Open Locker is not active", async () => {
          registerAccessProvider("open-locker", OpenLockerAccessProvider);
          sandbox.stub(TenantManager, "getTenant").resolves({
            id: "tenant-1",
            applications: [],
          });
          storedAnlage();
          request.body = {
            id: "anlage-1",
            config: { compartments: [{ id: COMPARTMENT_ID }] },
          };

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          expect(byId(COMPARTMENT_ID).scanCode).to.equal("code-fach-1");
        });

        it("keeps the code of a Fach put out of service", async () => {
          storedAnlage();
          request.body = {
            id: "anlage-1",
            config: {
              compartments: [{ id: COMPARTMENT_ID, outOfService: true }],
            },
          };

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          expect(byId(COMPARTMENT_ID)).to.include({
            outOfService: true,
            scanCode: "code-fach-1",
          });
        });

        it("gives a Fach taken out of the Anlage and back in a new code", async () => {
          const stored = storedAnlage();
          request.body = {
            id: "anlage-1",
            config: { compartments: [{ id: SECOND_COMPARTMENT_ID }] },
          };
          await AccessPointController.storeAccessPoint(request, response, next);
          stored.config = storeAccessPoint.firstCall.args[0].config;
          storeAccessPoint.resetHistory();

          request.body = {
            id: "anlage-1",
            config: {
              compartments: [
                { id: SECOND_COMPARTMENT_ID },
                { id: COMPARTMENT_ID },
              ],
            },
          };
          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          expect(byId(COMPARTMENT_ID).scanCode)
            .to.match(SCAN_CODE)
            .and.not.equal("code-fach-1");
          expect(byId(COMPARTMENT_ID).previousScanCodes).to.deep.equal([]);
        });

        // A rotation runs under the mutex of the Anlage (tickets#1061); a
        // save that read the Anlage before it must not write the old code
        // back, so the save takes the codes under the same mutex.
        it("keeps a code rotated while the save waited for the mutex of the Anlage", async () => {
          const stored = storedAnlage();
          const rotated = createAccessPoint({
            ...stored,
            config: {
              compartments: [
                {
                  ...stored.config.compartments[0],
                  scanCode: "rotated-code-fach-1",
                  previousScanCodes: ["code-fach-1", "earlier-code-fach-1"],
                },
              ],
            },
          });
          let held = false;
          LockerSystemMutex.hold.callsFake(async (lockerSystem, work) => {
            held = true;
            try {
              return await work();
            } finally {
              held = false;
            }
          });
          AccessPointManager.getAccessPoint.callsFake(async () =>
            held ? rotated : stored,
          );
          request.body = { id: "anlage-1", label: "Fahrradgarage Nord" };

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          expect(LockerSystemMutex.hold.firstCall.args[0].id).to.equal(
            "anlage-1",
          );
          expect(byId(COMPARTMENT_ID).scanCode).to.equal("rotated-code-fach-1");
          expect(byId(COMPARTMENT_ID).previousScanCodes).to.deep.equal([
            "code-fach-1",
            "earlier-code-fach-1",
          ]);
        });

        it("ignores the codes a request names, on a create and on an update", async () => {
          request.body = lockerSystem([
            {
              id: COMPARTMENT_ID,
              scanCode: "client-chosen-code",
              previousScanCodes: ["client-chosen-earlier-code"],
            },
          ]);
          await AccessPointController.storeAccessPoint(request, response, next);
          const created = storedCompartments()[0];
          storeAccessPoint.resetHistory();

          storedAnlage();
          request.body = {
            id: "anlage-1",
            config: {
              compartments: [
                {
                  id: COMPARTMENT_ID,
                  scanCode: "client-chosen-code",
                  previousScanCodes: ["client-chosen-earlier-code"],
                },
              ],
            },
          };
          await AccessPointController.storeAccessPoint(request, response, next);
          const updated = storedCompartments()[0];

          expect(next.called).to.be.false;
          expect(created.scanCode).to.match(SCAN_CODE);
          expect(created.previousScanCodes).to.deep.equal([]);
          expect(updated.scanCode).to.equal("code-fach-1");
          expect(updated.previousScanCodes).to.deep.equal([
            "earlier-code-fach-1",
          ]);
        });

        it("answers the create, the update and the reads without the codes of the Fächer", async () => {
          request.body = lockerSystem([{ id: COMPARTMENT_ID }]);
          await AccessPointController.storeAccessPoint(request, response, next);
          const createdCode = storedCompartments()[0].scanCode;
          const stored = storedAnlage();
          request.body = {
            id: "anlage-1",
            config: { compartments: [{ id: COMPARTMENT_ID }] },
          };
          await AccessPointController.storeAccessPoint(request, response, next);
          AccessPointManager.getAccessPoints.resolves([stored]);
          request.params.id = "anlage-1";
          await AccessPointController.getAccessPoint(request, response, next);
          await AccessPointController.getAccessPoints(request, response, next);

          expect(next.called).to.be.false;
          const answers = response.send.args.map(([answer]) => answer);
          expect(answers).to.have.length(4);
          const serialized = JSON.stringify(answers);
          expect(serialized).to.not.include(createdCode);
          expect(serialized).to.not.include("code-fach-1");
          expect(serialized).to.not.include("scanCode");
          expect(serialized).to.not.include("previousScanCodes");
          expect(answers[0].config.compartments[0].id).to.equal(COMPARTMENT_ID);
        });

        it("gives an Anlage of a provider that assigns the Fach itself no codes per Fach", async () => {
          request.body = {
            provider: "ifbs",
            type: "locker",
            mode: "remote",
            externalId: "location-1",
          };
          sandbox
            .stub(AccessInfoService, "findListedAccessPoint")
            .resolves(null);

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          expect(storeAccessPoint.firstCall.args[0].config).to.deep.equal({});
        });
      });

      /**
       * A Fach going out of service or out of the Anlage moves the future
       * bookings at it on the save; the answer names the ones that stay
       * (tickets#1043). Which bookings move is
       * `locker-system-redistribution.test.js`'s.
       */
      describe("a Fach leaving the Zuteilung", () => {
        const HOUR = 60 * 60 * 1000;
        let stored;

        beforeEach(() => {
          stored = createAccessPoint({
            id: "anlage-1",
            ...lockerSystem([
              {
                id: COMPARTMENT_ID,
                number: 1,
                lockerBank: { id: LOCKER_BANK_ID, name: "Labor Fachbank 1" },
                outOfService: false,
              },
            ]),
            externalId: "",
            validationRules: [],
          });
          sandbox.stub(AccessPointManager, "getAccessPoint").resolves(stored);
          bookingsHolding = [
            new Booking({
              id: "booking-1",
              tenantId: "tenant-1",
              name: "Erika Mustermann",
              mail: "erika@example.test",
              status: "confirmed",
              timeBegin: Date.now() + HOUR,
              timeEnd: Date.now() + 2 * HOUR,
              bookableItems: [{ bookableId: "faecher", amount: 1 }],
              accessInfo: [
                {
                  accessPointId: "anlage-1",
                  accessPointType: "locker",
                  provider: "open-locker",
                  bookableId: "faecher",
                  assignedCompartment: { id: COMPARTMENT_ID, number: 1 },
                  revokedAt: null,
                },
              ],
            }),
          ];
        });

        it("stores the Anlage under its mutex and moves the future booking to a free Fach in service", async () => {
          request.body = {
            id: "anlage-1",
            config: {
              compartments: [
                { id: COMPARTMENT_ID, outOfService: true },
                { id: SECOND_COMPARTMENT_ID },
              ],
            },
          };

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          expect(LockerSystemMutex.hold.firstCall.args[0].id).to.equal(
            "anlage-1",
          );
          expect(
            BookingManager.storeBooking.firstCall.args[0].accessInfo[0]
              .assignedCompartment.id,
          ).to.equal(SECOND_COMPARTMENT_ID);
          expect(response.status.calledWith(200)).to.be.true;
          expect(response.send.firstCall.args[0].unmovedBookings).to.deep.equal(
            [],
          );
        });

        it("names the future bookings no Fach was free for in its answer", async () => {
          request.body = {
            id: "anlage-1",
            config: {
              compartments: [{ id: COMPARTMENT_ID, outOfService: true }],
            },
          };

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          const answer = response.send.firstCall.args[0];
          expect(answer.id).to.equal("anlage-1");
          expect(answer.unmovedBookings).to.deep.equal([
            {
              id: "booking-1",
              name: "Erika Mustermann",
              mail: "erika@example.test",
              timeBegin: bookingsHolding[0].timeBegin,
              timeEnd: bookingsHolding[0].timeEnd,
              compartment: { id: COMPARTMENT_ID, number: 1 },
            },
          ]);
          expect(BookingManager.storeBooking.called).to.be.false;
        });

        // The save still holds the mutex, for the scan codes of the Fächer
        // (tickets#1055), but moves nothing.
        it("answers a save that takes no Fach out with nothing moved", async () => {
          request.body = { id: "anlage-1", label: "Fahrradgarage Nord" };

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          expect(BookingManager.storeBooking.called).to.be.false;
          expect(response.send.firstCall.args[0].unmovedBookings).to.deep.equal(
            [],
          );
        });
      });
    });

    /**
     * The Öffnungsart the save would leave behind, refused by the provider
     * that owns the vocabulary (spec § 3.1/§ 3.3). The controller asks every
     * provider that declares `validateAccessPoint` and names none of them.
     */
    describe("open action support", () => {
      it("refuses an open action that is not one of the provider's", async () => {
        findListedAccessPoint.resolves(listedNukiLock(4));
        request.body = {
          provider: "nuki",
          externalId: "lock-1",
          config: { openAction: "flip" },
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.statusCode).to.equal(400);
        expect(error.errors).to.deep.equal([
          {
            field: "config.openAction",
            code: "unknown_open_action",
            params: { openAction: "flip" },
          },
        ]);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("refuses an open action the device cannot carry out", async () => {
        findListedAccessPoint.resolves(listedNukiLock(2));
        request.body = {
          provider: "nuki",
          externalId: "lock-1",
          config: { openAction: "lock_n_go" },
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.statusCode).to.equal(400);
        expect(error.errors).to.deep.equal([
          {
            field: "config.openAction",
            code: "unsupported_open_action",
            params: {
              openAction: "lock_n_go",
              deviceType: 2,
              supportedOpenActions: ["auto"],
            },
          },
        ]);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("stores an open action the device can carry out, as it was sent", async () => {
        findListedAccessPoint.resolves(listedNukiLock(4));
        request.body = {
          provider: "nuki",
          externalId: "lock-1",
          config: { openAction: "unlatch" },
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        const [created] = storeAccessPoint.firstCall.args;
        expect(created.config).to.deep.equal({ openAction: "unlatch" });
      });

      it("stores an explicit `auto` rather than normalising it away", async () => {
        findListedAccessPoint.resolves(listedNukiLock(2));
        request.body = {
          provider: "nuki",
          externalId: "lock-1",
          config: { openAction: "auto" },
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        const [created] = storeAccessPoint.firstCall.args;
        expect(created.config).to.deep.equal({ openAction: "auto" });
      });

      it("lets an open action through when the provider does not list the lock", async () => {
        findListedAccessPoint.resolves(null);
        request.body = {
          provider: "nuki",
          externalId: "lock-1",
          config: { openAction: "lock_n_go_unlatch" },
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storeAccessPoint.calledOnce).to.be.true;
      });

      it("asks the provider about its listing only once, for both checks", async () => {
        findListedAccessPoint.resolves(listedNukiLock(2));
        request.body = {
          provider: "nuki",
          externalId: "lock-1",
          config: { openAction: "unlock" },
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(findListedAccessPoint.calledOnce).to.be.true;
        expect(next.firstCall.args[0]).to.be.instanceOf(ValidationError);
      });

      it("leaves the config of a provider without the check alone", async () => {
        findListedAccessPoint.resolves({
          id: "lock-9",
          provider: "salto-ks",
          externalId: "lock-9",
          metadata: { type: 2 },
        });
        request.body = {
          provider: "salto-ks",
          externalId: "lock-9",
          mode: "remote",
          config: { openAction: "flip" },
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        const [created] = storeAccessPoint.firstCall.args;
        expect(created.config).to.deep.equal({ openAction: "flip" });
      });

      it("judges an update by the open action the request would leave behind", async () => {
        sandbox
          .stub(AccessPointManager, "getAccessPoint")
          .resolves(createAccessPoint({ config: { openAction: "auto" } }));
        findListedAccessPoint.resolves(listedNukiLock(1));
        request.body = {
          id: "point-1",
          config: { openAction: "unlatch" },
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.errors[0]).to.deep.equal({
          field: "config.openAction",
          code: "unsupported_open_action",
          params: {
            openAction: "unlatch",
            deviceType: 1,
            supportedOpenActions: ["auto", "unlock"],
          },
        });
        expect(storeAccessPoint.called).to.be.false;
      });

      it("judges an update against the hardware it is being pointed at", async () => {
        sandbox
          .stub(AccessPointManager, "getAccessPoint")
          .resolves(createAccessPoint({ config: { openAction: "unlatch" } }));
        findListedAccessPoint.resolves(listedNukiLock(2));
        request.body = { id: "point-1", externalId: "lock-42" };

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.errors[0].code).to.equal("unsupported_open_action");
        expect(storeAccessPoint.called).to.be.false;
      });

      it("keeps the open action when the update leaves it doable", async () => {
        sandbox
          .stub(AccessPointManager, "getAccessPoint")
          .resolves(createAccessPoint({ config: { openAction: "unlatch" } }));
        findListedAccessPoint.resolves(listedNukiLock(4));
        request.body = { id: "point-1", label: "Nebeneingang" };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        const [updated] = storeAccessPoint.firstCall.args;
        expect(updated.config).to.deep.equal({ openAction: "unlatch" });
      });
    });

    /**
     * The provider is asked for its listing once per save and its failure
     * is answered as such (spec § 3.4): a rejected token is a 502, everything
     * else a 503, both naming the provider. Nothing is stored either way.
     */
    describe("provider listing", () => {
      function providerHttpError(status) {
        const failure = new Error(`Request failed with status code ${status}`);
        failure.response = { status };
        return failure;
      }

      it("asks the provider once per create", async () => {
        request.body = { provider: "nuki", externalId: "lock-1" };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(findListedAccessPoint.calledOnce).to.be.true;
        expect(storeAccessPoint.calledOnce).to.be.true;
      });

      it("asks the provider once per update", async () => {
        sandbox
          .stub(AccessPointManager, "getAccessPoint")
          .resolves(createAccessPoint());
        request.body = { id: "point-1", label: "Nebeneingang" };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(findListedAccessPoint.calledOnce).to.be.true;
        expect(storeAccessPoint.calledOnce).to.be.true;
      });

      [401, 403].forEach((status) => {
        it(`answers 502 access_provider_rejected when the provider rejects the token with ${status}`, async () => {
          findListedAccessPoint.rejects(providerHttpError(status));
          request.body = { provider: "nuki", externalId: "lock-1" };

          await AccessPointController.storeAccessPoint(request, response, next);

          const error = next.firstCall.args[0];
          expect(error).to.be.instanceOf(BaseError);
          expect(error.statusCode).to.equal(502);
          expect(error.code).to.equal("access_provider_rejected");
          expect(error.params).to.deep.equal({ provider: "nuki" });
          expect(storeAccessPoint.called).to.be.false;
        });
      });

      it("answers 503 access_provider_unreachable when the provider cannot be reached", async () => {
        const failure = new Error("connect ECONNREFUSED");
        failure.code = "ECONNREFUSED";
        findListedAccessPoint.rejects(failure);
        request.body = {
          provider: "salto-ks",
          externalId: "lock-9",
          mode: "remote",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(BaseError);
        expect(error.statusCode).to.equal(503);
        expect(error.code).to.equal("access_provider_unreachable");
        expect(error.params).to.deep.equal({ provider: "salto-ks" });
        expect(storeAccessPoint.called).to.be.false;
      });

      it("answers 503 access_provider_unreachable when the provider fails with a 5xx", async () => {
        findListedAccessPoint.rejects(providerHttpError(502));
        request.body = { provider: "nuki", externalId: "lock-1" };

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error.statusCode).to.equal(503);
        expect(error.code).to.equal("access_provider_unreachable");
        expect(error.params).to.deep.equal({ provider: "nuki" });
      });

      it("answers 503 on an update as well, storing nothing", async () => {
        sandbox
          .stub(AccessPointManager, "getAccessPoint")
          .resolves(createAccessPoint());
        findListedAccessPoint.rejects(new Error("timeout of 10000ms exceeded"));
        request.body = { id: "point-1", label: "Nebeneingang" };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.firstCall.args[0].statusCode).to.equal(503);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("stores an access point whose provider the tenant has not switched on, like one the provider does not list", async () => {
        findListedAccessPoint.rejects(
          new NotFoundError("nuki_application_not_found", {
            tenant: "tenant-1",
          }),
        );
        request.body = {
          provider: "nuki",
          externalId: "lock-1",
          mode: "remote",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storeAccessPoint.calledOnce).to.be.true;
        expect(response.status.calledWith(201)).to.be.true;
      });

      it("renames an access point whose provider the tenant has not switched on", async () => {
        sandbox
          .stub(AccessPointManager, "getAccessPoint")
          .resolves(createAccessPoint());
        findListedAccessPoint.rejects(
          new NotFoundError("nuki_application_not_found", {
            tenant: "tenant-1",
          }),
        );
        request.body = { id: "point-1", label: "Nebeneingang" };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        const [updated] = storeAccessPoint.firstCall.args;
        expect(updated.label).to.equal("Nebeneingang");
        expect(response.status.calledWith(200)).to.be.true;
      });

      it("keeps the mode check a 400 unsupported_mode, not a provider failure", async () => {
        findListedAccessPoint.resolves(listedAccessPoint(["authorization"]));
        request.body = {
          provider: "nuki",
          externalId: "lock-1",
          mode: "remote",
        };

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.statusCode).to.equal(400);
        expect(error.errors[0].code).to.equal("unsupported_mode");
      });
    });

    /**
     * A provider the registry does not know is a typo, and a typo has to show
     * where it is made, not at the door (tickets#272). The registry decides,
     * not the tenant's applications: a provider the tenant has not switched
     * on yet is still one an access point may be prepared for.
     */
    describe("provider registry", () => {
      const unknownProviderError = {
        field: "provider",
        code: "unknown_provider",
        params: { provider: "dummy" },
      };

      it("refuses to create an access point for a provider the registry does not know", async () => {
        request.body = { provider: "dummy", externalId: "lock-1" };

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.statusCode).to.equal(400);
        expect(error.errors).to.deep.equal([unknownProviderError]);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("refuses to change an access point to a provider the registry does not know", async () => {
        sandbox
          .stub(AccessPointManager, "getAccessPoint")
          .resolves(createAccessPoint());
        request.body = { id: "point-1", provider: "dummy" };

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.errors).to.deep.equal([unknownProviderError]);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("refuses to store an existing access point whose stored provider the registry does not know", async () => {
        sandbox
          .stub(AccessPointManager, "getAccessPoint")
          .resolves(createAccessPoint({ provider: "dummy" }));
        request.body = { id: "point-1", label: "Nebeneingang" };

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.errors).to.deep.equal([unknownProviderError]);
        expect(storeAccessPoint.called).to.be.false;
      });

      it("does not ask a provider the registry does not know", async () => {
        request.body = { provider: "dummy", externalId: "lock-1" };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(findListedAccessPoint.called).to.be.false;
      });

      it("stores an access point for a registered provider the tenant has not switched on", async () => {
        findListedAccessPoint.restore();
        sandbox
          .stub(TenantManager, "getTenant")
          .resolves({ id: "tenant-1", applications: [] });
        request.body = { provider: "pareva", externalId: "plant-1" };

        await AccessPointController.storeAccessPoint(request, response, next);

        expect(next.called).to.be.false;
        expect(storeAccessPoint.calledOnce).to.be.true;
        expect(response.status.calledWith(201)).to.be.true;
      });

      // tickets#311: every provider that lists its locks refuses to list them
      // for a tenant without its active application. That is no answer about
      // the lock, so the save goes through unchecked, to be checked on the
      // first save once the provider is active.
      // A compartment without its UUID is refused all the same: that rule
      // needs no listing.
      it("refuses an Open Locker compartment without a UUID while the tenant's application is not active", async () => {
        findListedAccessPoint.restore();
        sandbox.stub(TenantManager, "getTenant").resolves({
          id: "tenant-1",
          applications: [{ type: "access", id: "open-locker", active: false }],
        });
        request.body = { provider: "open-locker", mode: "remote" };

        await AccessPointController.storeAccessPoint(request, response, next);

        const error = next.firstCall.args[0];
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.errors).to.deep.equal([
          { field: "externalId", code: "required" },
        ]);
        expect(storeAccessPoint.called).to.be.false;
      });

      ["nuki", "ifbs", "salto-ks", "open-locker"].forEach((provider) => {
        it(`stores a ${provider} access point while the tenant's ${provider} application is not active`, async () => {
          findListedAccessPoint.restore();
          sandbox.stub(TenantManager, "getTenant").resolves({
            id: "tenant-1",
            applications: [{ type: "access", id: provider, active: false }],
          });
          request.body = { provider, externalId: "lock-1", mode: "remote" };

          await AccessPointController.storeAccessPoint(request, response, next);

          expect(next.called).to.be.false;
          expect(storeAccessPoint.calledOnce).to.be.true;
          expect(response.status.calledWith(201)).to.be.true;
        });
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

  /**
   * What the administration reads before a Fach leaves its Anlage
   * (tickets#1043): the running and future bookings at the Fächer. Which
   * ones those are is `locker-system-redistribution.test.js`'s.
   */
  describe("getCompartmentBookings", () => {
    let bookingsAt;

    beforeEach(() => {
      bookingsAt = sandbox
        .stub(LockerSystemRedistribution, "bookingsAt")
        .resolves({ total: 0, bookings: [] });
      request.params.id = "anlage-1";
    });

    it("asks for the Fächer the query names, at the Anlage of the path, capped like the booking list", async () => {
      const anlage = createAccessPoint({ id: "anlage-1", type: "locker" });
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(anlage);
      request.query = { compartmentIds: "uuid-1,uuid-2" };
      bookingsAt.resolves({ total: 1, bookings: [{ id: "booking-1" }] });

      await AccessPointController.getCompartmentBookings(
        request,
        response,
        next,
      );

      expect(bookingsAt.firstCall.args.slice(0, 3)).to.deep.equal([
        "tenant-1",
        anlage,
        ["uuid-1", "uuid-2"],
      ]);
      expect(bookingsAt.firstCall.args[3]).to.deep.include({ limit: 10 });
      expect(response.status.calledWith(200)).to.be.true;
      expect(response.json.firstCall.args[0]).to.deep.equal({
        total: 1,
        bookings: [{ id: "booking-1" }],
      });
    });

    it("takes the Fächer as a repeated parameter too", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(createAccessPoint({ id: "anlage-1" }));
      request.query = { compartmentIds: ["uuid-1", "uuid-2"] };

      await AccessPointController.getCompartmentBookings(
        request,
        response,
        next,
      );

      expect(bookingsAt.firstCall.args[2]).to.deep.equal(["uuid-1", "uuid-2"]);
    });

    it("answers 404 for an access point the tenant does not have", async () => {
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(null);

      await AccessPointController.getCompartmentBookings(
        request,
        response,
        next,
      );

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(bookingsAt.called).to.be.false;
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

    it("answers 404 for an Anlage with its own list of Fächer: its own code is never printed", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(createOwnListAnlage());

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

    it("answers 503 store_front_url_missing when the instance has no store-front address", async () => {
      render.restore();
      const storeFrontUrl = process.env.STORE_FRONT_URL;
      delete process.env.STORE_FRONT_URL;
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(createAccessPoint());

      try {
        await AccessPointController.getQrCode(request, response, next);
      } finally {
        if (storeFrontUrl !== undefined) {
          process.env.STORE_FRONT_URL = storeFrontUrl;
        }
      }

      const error = next.firstCall.args[0];
      expect(error).to.be.instanceOf(BaseError);
      expect(error.statusCode).to.equal(503);
      expect(error.code).to.equal("store_front_url_missing");
      expect(response.send.called).to.be.false;
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

  // tickets#1056: the QR code of one Fach, addressed by Anlage and Fach UUID.
  describe("getCompartmentQrCode", () => {
    const FACH_ID = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
    let renderCompartment;

    function anlage(compartments) {
      return createAccessPoint({
        id: "anlage-1",
        provider: "open-locker",
        type: "locker",
        externalId: null,
        label: "Fahrradgarage",
        config: { compartments },
      });
    }

    function fach(overrides = {}) {
      return {
        id: FACH_ID,
        number: 3,
        lockerBank: { id: "bank-1", name: "Labor Fachbank 1" },
        outOfService: false,
        scanCode: "fach-code",
        previousScanCodes: [],
        ...overrides,
      };
    }

    beforeEach(() => {
      request.params.id = "anlage-1";
      request.params.compartmentId = FACH_ID;
      renderCompartment = sandbox
        .stub(AccessQrService, "renderCompartment")
        .resolves({
          format: "svg",
          contentType: "image/svg+xml",
          body: "<svg></svg>",
          filename: "qr-fahrradgarage-schrank-labor-fachbank-1-fach-03.svg",
        });
    });

    it("renders the Fach's QR code as svg by default, named for download", async () => {
      const entry = fach();
      const stored = anlage([fach({ id: "other", number: 1 }), entry]);
      const getAccessPoint = sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(stored);

      await AccessPointController.getCompartmentQrCode(request, response, next);

      expect(getAccessPoint.calledOnceWithExactly("anlage-1", "tenant-1")).to.be
        .true;
      expect(renderCompartment.calledOnceWithExactly(stored, entry, "svg")).to
        .be.true;
      expect(response.setHeader.calledWith("Content-Type", "image/svg+xml")).to
        .be.true;
      expect(
        response.setHeader.calledWith(
          "Content-Disposition",
          'inline; filename="qr-fahrradgarage-schrank-labor-fachbank-1-fach-03.svg"',
        ),
      ).to.be.true;
      expect(response.status.calledWith(200)).to.be.true;
      expect(response.send.calledWith("<svg></svg>")).to.be.true;
    });

    it("passes the requested format through", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(anlage([fach()]));
      request.query.format = "pdf";

      await AccessPointController.getCompartmentQrCode(request, response, next);

      expect(renderCompartment.firstCall.args[2]).to.equal("pdf");
    });

    it("renders a Fach out of service as well: its code stays valid", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(anlage([fach({ outOfService: true })]));

      await AccessPointController.getCompartmentQrCode(request, response, next);

      expect(renderCompartment.calledOnce).to.be.true;
      expect(response.status.calledWith(200)).to.be.true;
    });

    it("answers 400 for an unsupported format", async () => {
      const getAccessPoint = sandbox.stub(AccessPointManager, "getAccessPoint");
      request.query.format = "bmp";

      await AccessPointController.getCompartmentQrCode(request, response, next);

      expect(response.status.calledWith(400)).to.be.true;
      expect(getAccessPoint.called).to.be.false;
      expect(renderCompartment.called).to.be.false;
    });

    it("answers 404 for an access point of another tenant", async () => {
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(null);

      await AccessPointController.getCompartmentQrCode(request, response, next);

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(renderCompartment.called).to.be.false;
    });

    it("answers 404 for a door", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(createAccessPoint());

      await AccessPointController.getCompartmentQrCode(request, response, next);

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(renderCompartment.called).to.be.false;
    });

    it("answers 404 for an Anlage without its own list of Fächer (iFBS, Pareva)", async () => {
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(
        createAccessPoint({
          id: "anlage-1",
          provider: "ifbs",
          type: "locker",
          externalId: "station-1",
          config: {},
        }),
      );

      await AccessPointController.getCompartmentQrCode(request, response, next);

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(renderCompartment.called).to.be.false;
    });

    it("answers 404 for a Fach the Anlage does not carry", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(anlage([fach({ id: "another-fach" })]));

      await AccessPointController.getCompartmentQrCode(request, response, next);

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(renderCompartment.called).to.be.false;
    });

    it("hands unexpected errors to the error handler", async () => {
      const failure = new Error("Render Error");
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(anlage([fach()]));
      renderCompartment.rejects(failure);

      await AccessPointController.getCompartmentQrCode(request, response, next);

      expect(next.calledOnceWithExactly(failure)).to.be.true;
    });
  });

  describe("getCompartmentQrSheet", () => {
    let renderCompartmentSheet;

    function anlage(compartments) {
      return createAccessPoint({
        id: "anlage-1",
        provider: "open-locker",
        type: "locker",
        externalId: null,
        label: "Fahrradgarage",
        config: { compartments },
      });
    }

    const FACH = {
      id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
      number: 3,
      lockerBank: { id: "bank-1", name: "Labor Fachbank 1" },
      outOfService: false,
      scanCode: "fach-code",
      previousScanCodes: [],
    };

    beforeEach(() => {
      request.params.id = "anlage-1";
      renderCompartmentSheet = sandbox
        .stub(AccessQrService, "renderCompartmentSheet")
        .resolves({
          format: "pdf",
          contentType: "application/pdf",
          body: Buffer.from("pdf"),
          filename: "qr-fahrradgarage-alle-faecher.pdf",
        });
    });

    it("renders the Sammel-PDF of the Anlage, named for download", async () => {
      const stored = anlage([FACH]);
      const getAccessPoint = sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(stored);

      await AccessPointController.getCompartmentQrSheet(
        request,
        response,
        next,
      );

      expect(getAccessPoint.calledOnceWithExactly("anlage-1", "tenant-1")).to.be
        .true;
      expect(renderCompartmentSheet.calledOnceWithExactly(stored)).to.be.true;
      expect(response.setHeader.calledWith("Content-Type", "application/pdf"))
        .to.be.true;
      expect(
        response.setHeader.calledWith(
          "Content-Disposition",
          'inline; filename="qr-fahrradgarage-alle-faecher.pdf"',
        ),
      ).to.be.true;
      expect(response.status.calledWith(200)).to.be.true;
      expect(response.send.firstCall.args[0].toString()).to.equal("pdf");
    });

    it("answers 404 for an access point of another tenant", async () => {
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(null);

      await AccessPointController.getCompartmentQrSheet(
        request,
        response,
        next,
      );

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(renderCompartmentSheet.called).to.be.false;
    });

    it("answers 404 for a door", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(createAccessPoint());

      await AccessPointController.getCompartmentQrSheet(
        request,
        response,
        next,
      );

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(renderCompartmentSheet.called).to.be.false;
    });

    it("answers 404 for an Anlage without its own list of Fächer (iFBS, Pareva)", async () => {
      sandbox.stub(AccessPointManager, "getAccessPoint").resolves(
        createAccessPoint({
          id: "anlage-1",
          provider: "ifbs",
          type: "locker",
          externalId: "station-1",
          config: {},
        }),
      );

      await AccessPointController.getCompartmentQrSheet(
        request,
        response,
        next,
      );

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(renderCompartmentSheet.called).to.be.false;
    });

    it("hands unexpected errors to the error handler", async () => {
      const failure = new Error("Render Error");
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(anlage([FACH]));
      renderCompartmentSheet.rejects(failure);

      await AccessPointController.getCompartmentQrSheet(
        request,
        response,
        next,
      );

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

    it("answers 404 for an Anlage with its own list of Fächer and stores nothing: its own code is never rotated", async () => {
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .resolves(createOwnListAnlage());

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

  /**
   * The scan code of one Fach of an Anlage that carries its own list
   * (tickets#1061), rotated like a door's, under the mutex of the Anlage.
   * The manager answers the row of an in-memory store: each read a fresh
   * copy, each store a write of it.
   */
  describe("rotateCompartmentScanCode", () => {
    const FACH_ID = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
    const OTHER_FACH_ID = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
    let row;
    let holds;
    let storeAccessPoint;

    function fach(overrides = {}) {
      return {
        id: FACH_ID,
        number: 3,
        lockerBank: { id: "bank-1", name: "Labor Fachbank 1" },
        outOfService: false,
        scanCode: "code-fach-3",
        previousScanCodes: ["earlier-code-fach-3"],
        ...overrides,
      };
    }

    function anlage(compartments) {
      return createAccessPoint({
        id: "anlage-1",
        provider: "open-locker",
        type: "locker",
        externalId: null,
        label: "Fahrradgarage",
        config: { compartments },
      }).toDocument();
    }

    const copy = (document) => JSON.parse(JSON.stringify(document));
    const storedFach = (id = FACH_ID) =>
      row.config.compartments.find((compartment) => compartment.id === id);

    beforeEach(() => {
      // The real mutex, over holds in memory (restored by sinon.restore).
      holds = installInMemoryLockerSystemHolds();
      request.params.id = "anlage-1";
      request.params.compartmentId = FACH_ID;
      row = anlage([fach(), fach({ id: OTHER_FACH_ID, number: 4 })]);
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .callsFake(async (id, tenantId) =>
          row && id === row.id && tenantId === row.tenantId
            ? new AccessPoint(copy(row))
            : null,
        );
      storeAccessPoint = sandbox
        .stub(AccessPointManager, "storeAccessPoint")
        .callsFake(async (accessPoint) => {
          row = copy(accessPoint.toDocument());
          return new AccessPoint(copy(row));
        });
    });

    afterEach(() => {
      sinon.restore();
    });

    it("rotates the Fach's code: the old one moves to the front of the earlier codes", async () => {
      await AccessPointController.rotateCompartmentScanCode(
        request,
        response,
        next,
      );

      expect(next.called).to.be.false;
      expect(response.status.calledWith(200)).to.be.true;
      expect(storeAccessPoint.calledOnce).to.be.true;
      expect(storeAccessPoint.firstCall.args[1]).to.equal("tenant-1");
      expect(storedFach().scanCode)
        .to.match(/^[A-Za-z0-9_-]{32}$/)
        .and.not.equal("code-fach-3");
      expect(storedFach().previousScanCodes).to.deep.equal([
        "code-fach-3",
        "earlier-code-fach-3",
      ]);
    });

    it("keeps at most 5 earlier codes, the oldest fall off", async () => {
      row = anlage([
        fach({
          scanCode: "code-6",
          previousScanCodes: ["code-5", "code-4", "code-3", "code-2", "code-1"],
        }),
      ]);

      await AccessPointController.rotateCompartmentScanCode(
        request,
        response,
        next,
      );

      expect(storedFach().previousScanCodes).to.deep.equal([
        "code-6",
        "code-5",
        "code-4",
        "code-3",
        "code-2",
      ]);
    });

    it("leaves the other Fächer and the Anlage's own code as they are", async () => {
      const anlageCode = row.scanCode;

      await AccessPointController.rotateCompartmentScanCode(
        request,
        response,
        next,
      );

      expect(storedFach(OTHER_FACH_ID)).to.deep.equal(
        fach({ id: OTHER_FACH_ID, number: 4 }),
      );
      expect(row.scanCode).to.equal(anlageCode);
      expect(row.previousScanCodes).to.deep.equal([]);
    });

    it("returns neither the old nor the new code", async () => {
      await AccessPointController.rotateCompartmentScanCode(
        request,
        response,
        next,
      );

      const serialized = JSON.stringify(response.send.firstCall.args[0]);
      expect(serialized).to.include(FACH_ID);
      expect(serialized).to.not.include("code-fach-3");
      expect(serialized).to.not.include(storedFach().scanCode);
      expect(serialized).to.not.include("scanCode");
    });

    // A save of the Anlage holds the same mutex and takes the codes it
    // stores under it (tickets#1055), so it keeps a code rotated before.
    // The other way round: a rotation that came while a save held the
    // Anlage waits, and rotates what the save stored.
    it("waits for a save holding the Anlage and rotates what that save stored", async () => {
      let finishSave;
      const save = LockerSystemMutex.hold(
        { tenantId: "tenant-1", id: "anlage-1" },
        () =>
          new Promise((resolve) => {
            finishSave = resolve;
          }).then(() => {
            // The save stores the Anlage with a new label.
            row = { ...copy(row), label: "Fahrradgarage Nord" };
          }),
      );
      while (!holds.has("tenant-1:anlage-1")) {
        await Promise.resolve();
      }
      let rotated = false;
      const rotation = AccessPointController.rotateCompartmentScanCode(
        request,
        response,
        next,
      ).then(() => {
        rotated = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rotated).to.be.false;

      finishSave();
      await save;
      await rotation;

      expect(next.called).to.be.false;
      expect(row.label).to.equal("Fahrradgarage Nord");
      expect(storedFach().previousScanCodes[0]).to.equal("code-fach-3");
    });

    it("answers 404 for an access point of another tenant", async () => {
      request.params.tenant = "tenant-2";

      await AccessPointController.rotateCompartmentScanCode(
        request,
        response,
        next,
      );

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(storeAccessPoint.called).to.be.false;
    });

    it("answers 404 for a door", async () => {
      row = createAccessPoint({ id: "anlage-1" }).toDocument();

      await AccessPointController.rotateCompartmentScanCode(
        request,
        response,
        next,
      );

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(storeAccessPoint.called).to.be.false;
    });

    it("answers 404 for an Anlage without its own list of Fächer (iFBS, Pareva)", async () => {
      row = createAccessPoint({
        id: "anlage-1",
        provider: "ifbs",
        type: "locker",
        externalId: "station-1",
        config: {},
      }).toDocument();

      await AccessPointController.rotateCompartmentScanCode(
        request,
        response,
        next,
      );

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(storeAccessPoint.called).to.be.false;
    });

    it("answers 404 for a Fach the Anlage does not carry, and changes no code", async () => {
      request.params.compartmentId = "another-fach";
      const before = copy(row);

      await AccessPointController.rotateCompartmentScanCode(
        request,
        response,
        next,
      );

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(storeAccessPoint.called).to.be.false;
      expect(row).to.deep.equal(before);
    });

    it("hands unexpected errors to the error handler", async () => {
      const failure = new Error("Database Error");
      storeAccessPoint.rejects(failure);

      await AccessPointController.rotateCompartmentScanCode(
        request,
        response,
        next,
      );

      expect(next.calledOnceWithExactly(failure)).to.be.true;
    });
  });

  describe("rotateAllCompartmentScanCodes", () => {
    const FACH_ID = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
    const OTHER_FACH_ID = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
    let row;
    let holds;
    let storeAccessPoint;

    function fach(overrides = {}) {
      return {
        id: FACH_ID,
        number: 3,
        lockerBank: { id: "bank-1", name: "Labor Fachbank 1" },
        outOfService: false,
        scanCode: "code-fach-3",
        previousScanCodes: ["earlier-code-fach-3"],
        ...overrides,
      };
    }

    function anlage(compartments) {
      return createAccessPoint({
        id: "anlage-1",
        provider: "open-locker",
        type: "locker",
        externalId: null,
        label: "Fahrradgarage",
        config: { compartments },
      }).toDocument();
    }

    const copy = (document) => JSON.parse(JSON.stringify(document));
    const storedFach = (id) =>
      row.config.compartments.find((compartment) => compartment.id === id);

    beforeEach(() => {
      // The real mutex, over holds in memory (restored by sinon.restore).
      holds = installInMemoryLockerSystemHolds();
      request.params.id = "anlage-1";
      row = anlage([
        fach(),
        fach({
          id: OTHER_FACH_ID,
          number: 4,
          outOfService: true,
          scanCode: "code-fach-4",
          previousScanCodes: [],
        }),
      ]);
      sandbox
        .stub(AccessPointManager, "getAccessPoint")
        .callsFake(async (id, tenantId) =>
          row && id === row.id && tenantId === row.tenantId
            ? new AccessPoint(copy(row))
            : null,
        );
      storeAccessPoint = sandbox
        .stub(AccessPointManager, "storeAccessPoint")
        .callsFake(async (accessPoint) => {
          row = copy(accessPoint.toDocument());
          return new AccessPoint(copy(row));
        });
    });

    afterEach(() => {
      sinon.restore();
    });

    it("rotates the code of every Fach, out of service too, and stores the Anlage once", async () => {
      await AccessPointController.rotateAllCompartmentScanCodes(
        request,
        response,
        next,
      );

      expect(next.called).to.be.false;
      expect(response.status.calledWith(200)).to.be.true;
      expect(storeAccessPoint.calledOnce).to.be.true;
      expect(storeAccessPoint.firstCall.args[1]).to.equal("tenant-1");
      expect(storedFach(FACH_ID).scanCode)
        .to.match(/^[A-Za-z0-9_-]{32}$/)
        .and.not.equal("code-fach-3");
      expect(storedFach(FACH_ID).previousScanCodes).to.deep.equal([
        "code-fach-3",
        "earlier-code-fach-3",
      ]);
      expect(storedFach(OTHER_FACH_ID).scanCode)
        .to.match(/^[A-Za-z0-9_-]{32}$/)
        .and.not.equal("code-fach-4");
      expect(storedFach(OTHER_FACH_ID).previousScanCodes).to.deep.equal([
        "code-fach-4",
      ]);
      expect(storedFach(FACH_ID).scanCode).to.not.equal(
        storedFach(OTHER_FACH_ID).scanCode,
      );
    });

    it("keeps at most 5 earlier codes per Fach, the oldest fall off", async () => {
      row = anlage([
        fach({
          scanCode: "code-6",
          previousScanCodes: ["code-5", "code-4", "code-3", "code-2", "code-1"],
        }),
      ]);

      await AccessPointController.rotateAllCompartmentScanCodes(
        request,
        response,
        next,
      );

      expect(storedFach(FACH_ID).previousScanCodes).to.deep.equal([
        "code-6",
        "code-5",
        "code-4",
        "code-3",
        "code-2",
      ]);
    });

    it("leaves the Anlage's own code as it is", async () => {
      const anlageCode = row.scanCode;

      await AccessPointController.rotateAllCompartmentScanCodes(
        request,
        response,
        next,
      );

      expect(row.scanCode).to.equal(anlageCode);
      expect(row.previousScanCodes).to.deep.equal([]);
    });

    it("returns neither the old nor the new codes", async () => {
      await AccessPointController.rotateAllCompartmentScanCodes(
        request,
        response,
        next,
      );

      const serialized = JSON.stringify(response.send.firstCall.args[0]);
      expect(serialized).to.include(FACH_ID);
      expect(serialized).to.include(OTHER_FACH_ID);
      expect(serialized).to.not.include("code-fach-3");
      expect(serialized).to.not.include("code-fach-4");
      expect(serialized).to.not.include(storedFach(FACH_ID).scanCode);
      expect(serialized).to.not.include(storedFach(OTHER_FACH_ID).scanCode);
      expect(serialized).to.not.include("scanCode");
    });

    // Like the rotation of one Fach: a rotation that came while a save held
    // the Anlage waits, and rotates what the save stored - here a Fach the
    // save added, which gets rotated too.
    it("waits for a save holding the Anlage and rotates what that save stored", async () => {
      let finishSave;
      const save = LockerSystemMutex.hold(
        { tenantId: "tenant-1", id: "anlage-1" },
        () =>
          new Promise((resolve) => {
            finishSave = resolve;
          }).then(() => {
            // The save stores the Anlage with a new label and a new Fach.
            const saved = copy(row);
            saved.label = "Fahrradgarage Nord";
            saved.config.compartments.push(
              fach({ id: "new-fach", number: 5, scanCode: "code-fach-5" }),
            );
            row = saved;
          }),
      );
      while (!holds.has("tenant-1:anlage-1")) {
        await Promise.resolve();
      }
      let rotated = false;
      const rotation = AccessPointController.rotateAllCompartmentScanCodes(
        request,
        response,
        next,
      ).then(() => {
        rotated = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rotated).to.be.false;

      finishSave();
      await save;
      await rotation;

      expect(next.called).to.be.false;
      expect(row.label).to.equal("Fahrradgarage Nord");
      expect(storedFach(FACH_ID).previousScanCodes[0]).to.equal("code-fach-3");
      expect(storedFach("new-fach").previousScanCodes[0]).to.equal(
        "code-fach-5",
      );
    });

    it("answers 404 for an access point of another tenant", async () => {
      request.params.tenant = "tenant-2";

      await AccessPointController.rotateAllCompartmentScanCodes(
        request,
        response,
        next,
      );

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(storeAccessPoint.called).to.be.false;
    });

    it("answers 404 for a door", async () => {
      row = createAccessPoint({ id: "anlage-1" }).toDocument();
      const before = copy(row);

      await AccessPointController.rotateAllCompartmentScanCodes(
        request,
        response,
        next,
      );

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(storeAccessPoint.called).to.be.false;
      expect(row).to.deep.equal(before);
    });

    it("answers 404 for an Anlage without its own list of Fächer (iFBS, Pareva)", async () => {
      row = createAccessPoint({
        id: "anlage-1",
        provider: "ifbs",
        type: "locker",
        externalId: "station-1",
        config: {},
      }).toDocument();

      await AccessPointController.rotateAllCompartmentScanCodes(
        request,
        response,
        next,
      );

      expect(response.sendStatus.calledWith(404)).to.be.true;
      expect(storeAccessPoint.called).to.be.false;
    });

    it("hands unexpected errors to the error handler", async () => {
      const failure = new Error("Database Error");
      storeAccessPoint.rejects(failure);

      await AccessPointController.rotateAllCompartmentScanCodes(
        request,
        response,
        next,
      );

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
