const { expect } = require("chai");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  SaltoKsApiClient,
} = require("../src/commons/services/access/clients/salto-ks-api-client");
const SaltoKsIqActivationService = require("../src/commons/services/access/salto-ks-iq-activation-service");
const SaltoKsAccessProvider = require("../src/commons/services/access/providers/salto-ks-access-provider");
const { AccessOpenError } = require("../src/errors/AccessOpenError");
const {
  AccessPointMode,
} = require("../src/commons/entities/access/access-point");

const TENANT_ID = "tenant-1";
const IQ_ID = "5dfdc54e-8335-11f0-a2ed-6045bd92d38f";
const LOCK_ID = "4d77312f-4a87-41db-a97b-f9d948dcc908";

function stubTenant(iqActivations = []) {
  sinon.stub(TenantManager, "getTenant").resolves({
    id: TENANT_ID,
    applications: [
      {
        type: "access",
        id: "salto-ks",
        active: true,
        clientId: "client-id",
        clientSecret: "client-secret",
        username: "system-user@example.test",
        password: "password",
        siteId: "site-1",
        environment: "accept",
        iqActivations,
      },
    ],
  });
}

function saltoLock(overrides = {}) {
  return {
    id: LOCK_ID,
    customer_reference: "Tür 01",
    lock_type: "escutcheon",
    online: true,
    iq: { id: IQ_ID, otp_enabled: true, is_online: true },
    ...overrides,
  };
}

function saltoIq(overrides = {}) {
  return {
    id: IQ_ID,
    customer_reference: "IQ 01",
    otp_enabled: true,
    online: true,
    restore_required: false,
    ...overrides,
  };
}

function saltoError(status, errorCode, message) {
  const err = new Error(message);
  err.response = { status, data: { ErrorCode: errorCode, Message: message } };
  return err;
}

describe("SaltoKsAccessProvider.open", () => {
  let provider;
  let getLocks;
  let getIqs;
  let openLock;

  beforeEach(() => {
    provider = new SaltoKsAccessProvider();
    stubTenant();
    getLocks = sinon
      .stub(SaltoKsApiClient.prototype, "getLocks")
      .resolves([saltoLock()]);
    getIqs = sinon
      .stub(SaltoKsApiClient.prototype, "getIqs")
      .resolves([saltoIq()]);
    openLock = sinon
      .stub(SaltoKsApiClient.prototype, "openLock")
      .resolves({ locked_state: "unlocked" });
    sinon
      .stub(SaltoKsIqActivationService, "resolveOtpForOpen")
      .resolves({ otp: "28a5a" });
    sinon.stub(SaltoKsIqActivationService, "recordOpenSuccess").resolves();
    sinon.stub(SaltoKsIqActivationService, "recordOtpInvalid").resolves();
    sinon.stub(SaltoKsIqActivationService, "recordOtpBlocked").resolves();
    sinon
      .stub(SaltoKsIqActivationService, "markReactivationRequired")
      .resolves();
  });

  afterEach(() => {
    sinon.restore();
  });

  const accessPoint = { externalId: LOCK_ID, provider: "salto-ks" };
  const bookingContext = { tenant: TENANT_ID };

  it("opens with a self-computed OTP for the lock's IQ", async () => {
    const result = await provider.open(accessPoint, bookingContext);

    expect(
      SaltoKsIqActivationService.resolveOtpForOpen.calledOnceWith(TENANT_ID, {
        id: IQ_ID,
        otp_enabled: true,
      }),
    ).to.be.true;
    expect(openLock.calledOnce).to.be.true;
    expect(openLock.firstCall.args[0]).to.equal(LOCK_ID);
    expect(openLock.firstCall.args[1]).to.deep.equal({ otp: "28a5a" });
    expect(
      SaltoKsIqActivationService.recordOpenSuccess.calledOnceWith(
        TENANT_ID,
        IQ_ID,
      ),
    ).to.be.true;
    expect(result.success).to.be.true;
  });

  it("never takes an OTP from the caller", async () => {
    await provider.open(accessPoint, {
      ...bookingContext,
      openOptions: { otp: "caller-otp" },
    });

    expect(openLock.firstCall.args[1]).to.deep.equal({ otp: "28a5a" });
  });

  it("refuses without a Salto call while the IQ is not activated", async () => {
    SaltoKsIqActivationService.resolveOtpForOpen.rejects(
      AccessOpenError.configuration("not activated"),
    );

    try {
      await provider.open(accessPoint, bookingContext);
      throw new Error("expected open to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(AccessOpenError);
      expect(err.failureClass).to.equal("configuration");
    }
    expect(openLock.called).to.be.false;
  });

  it("books otp_invalid as temporary, exactly one OTP per attempt", async () => {
    openLock.rejects(saltoError(400, 3102, "otp_invalid"));

    try {
      await provider.open(accessPoint, bookingContext);
      throw new Error("expected open to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(AccessOpenError);
      expect(err.failureClass).to.equal("temporary");
    }

    expect(openLock.calledOnce).to.be.true;
    expect(
      SaltoKsIqActivationService.recordOtpInvalid.calledOnceWith(
        TENANT_ID,
        IQ_ID,
      ),
    ).to.be.true;
    expect(SaltoKsIqActivationService.recordOpenSuccess.called).to.be.false;
  });

  it("starts the backoff on otp_blocked", async () => {
    openLock.rejects(saltoError(403, 3102, "otp_blocked"));

    try {
      await provider.open(accessPoint, bookingContext);
      throw new Error("expected open to throw");
    } catch (err) {
      expect(err.failureClass).to.equal("temporary");
    }

    expect(
      SaltoKsIqActivationService.recordOtpBlocked.calledOnceWith(
        TENANT_ID,
        IQ_ID,
      ),
    ).to.be.true;
    expect(SaltoKsIqActivationService.recordOtpInvalid.called).to.be.false;
  });

  it("reports a missing remote right as a configuration failure", async () => {
    openLock.rejects(saltoError(403, 1001, "Forbidden"));

    try {
      await provider.open(accessPoint, bookingContext);
      throw new Error("expected open to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(AccessOpenError);
      expect(err.failureClass).to.equal("configuration");
    }

    expect(SaltoKsIqActivationService.recordOtpInvalid.called).to.be.false;
    expect(SaltoKsIqActivationService.recordOtpBlocked.called).to.be.false;
  });

  it("reports everything else (e.g. an offline lock) as temporary without bookkeeping", async () => {
    openLock.rejects(saltoError(409, 4000, "lock offline"));

    try {
      await provider.open(accessPoint, bookingContext);
      throw new Error("expected open to throw");
    } catch (err) {
      expect(err.failureClass).to.equal("temporary");
    }

    expect(SaltoKsIqActivationService.recordOtpInvalid.called).to.be.false;
    expect(SaltoKsIqActivationService.recordOtpBlocked.called).to.be.false;
  });

  it("opens a lock on an IQ without otp_enabled without any OTP", async () => {
    getLocks.resolves([
      saltoLock({ iq: { id: IQ_ID, otp_enabled: false, is_online: true } }),
    ]);
    SaltoKsIqActivationService.resolveOtpForOpen.resolves({ otp: null });

    await provider.open(accessPoint, bookingContext);

    expect(openLock.firstCall.args[1]).to.deep.equal({ otp: null });
    expect(SaltoKsIqActivationService.recordOpenSuccess.called).to.be.false;
  });

  it("flags restore_required at open time and books the re-activation", async () => {
    getIqs.resolves([saltoIq({ restore_required: true })]);

    try {
      await provider.open(accessPoint, bookingContext);
      throw new Error("expected open to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(AccessOpenError);
      expect(err.failureClass).to.equal("configuration");
    }

    expect(
      SaltoKsIqActivationService.markReactivationRequired.calledOnceWith(
        TENANT_ID,
        IQ_ID,
      ),
    ).to.be.true;
    expect(openLock.called).to.be.false;
  });

  it("refuses a known lock during the backoff without any Salto call", async () => {
    // First open teaches the provider which IQ the lock hangs on.
    await provider.open(accessPoint, bookingContext);
    expect(getLocks.calledOnce).to.be.true;

    // From now on the local refusal comes before any Salto request.
    SaltoKsIqActivationService.resolveOtpForOpen.rejects(
      AccessOpenError.temporary("backing off after otp_blocked"),
    );

    try {
      await provider.open(accessPoint, bookingContext);
      throw new Error("expected open to throw");
    } catch (err) {
      expect(err.failureClass).to.equal("temporary");
    }

    expect(getLocks.calledOnce).to.be.true;
    expect(getIqs.calledOnce).to.be.true;
    expect(openLock.calledOnce).to.be.true;
  });

  it("reports a lock Salto does not list as a configuration failure", async () => {
    getLocks.resolves([]);

    try {
      await provider.open(accessPoint, bookingContext);
      throw new Error("expected open to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(AccessOpenError);
      expect(err.failureClass).to.equal("configuration");
    }
    expect(openLock.called).to.be.false;
  });
});

describe("AccessController rendering of open failures", () => {
  const AccessController = require("../src/platform/api/controllers/access-controller");
  const AccessService = require("../src/commons/services/access/access-service");
  const PermissionService = require("../src/commons/services/permission-service");

  let request;
  let response;

  beforeEach(() => {
    request = {
      params: { tenant: TENANT_ID, accessPointId: "point-1" },
      query: { bookingId: "booking-1" },
      body: {},
      user: { id: "user-1" },
    };
    response = {
      status: sinon.stub().returnsThis(),
      json: sinon.stub(),
      send: sinon.stub(),
      sendStatus: sinon.stub(),
    };
    sinon.stub(PermissionService, "_allowUpdateAny").resolves(false);
  });

  afterEach(() => {
    sinon.restore();
  });

  it("tells the guest only the failure class, never the Salto detail", async () => {
    sinon
      .stub(AccessService, "open")
      .rejects(AccessOpenError.temporary("Salto KS rejected the OTP: 3102"));

    await AccessController.open(request, response);

    expect(response.status.calledOnceWith(200)).to.be.true;
    const body = response.json.firstCall.args[0];
    expect(body.success).to.be.false;
    expect(body.data.openFailure).to.equal("temporary");
    expect(JSON.stringify(body)).to.not.include("Salto");
  });

  it("renders a configuration failure as such", async () => {
    sinon
      .stub(AccessService, "open")
      .rejects(AccessOpenError.configuration("IQ not activated"));

    await AccessController.open(request, response);

    const body = response.json.firstCall.args[0];
    expect(body.data.openFailure).to.equal("configuration");
  });
});

describe("SaltoKsAccessProvider capability rule", () => {
  let provider;

  beforeEach(() => {
    provider = new SaltoKsAccessProvider();
    sinon.stub(SaltoKsApiClient.prototype, "getIqs").resolves([saltoIq()]);
  });

  afterEach(() => {
    sinon.restore();
  });

  function stubLocks(locks) {
    sinon.stub(SaltoKsApiClient.prototype, "getLocks").resolves(locks);
  }

  const activated = [
    {
      iqId: IQ_ID,
      secret: { iv: "iv", data: "data" },
      pin: { iv: "iv", data: "data" },
      state: "activated",
    },
  ];

  it("offers remote and authorization for a keypad lock on an activated IQ", async () => {
    stubTenant(activated);
    stubLocks([saltoLock({ lock_type: "escutcheon_pin" })]);

    const [point] = await provider.listAccessPoints(TENANT_ID);

    expect(point.supportedModes).to.have.members([
      AccessPointMode.REMOTE,
      AccessPointMode.AUTHORIZATION,
      AccessPointMode.BOTH,
    ]);
    expect(point.capabilities).to.have.members(["remote", "authorization"]);
  });

  it("offers only remote for a lock without keypad", async () => {
    stubTenant(activated);
    stubLocks([saltoLock({ lock_type: "escutcheon" })]);

    const [point] = await provider.listAccessPoints(TENANT_ID);

    expect(point.supportedModes).to.deep.equal([AccessPointMode.REMOTE]);
    expect(point.capabilities).to.deep.equal(["remote"]);
  });

  it("drops remote while the IQ is not activated", async () => {
    stubTenant([]);
    stubLocks([
      saltoLock({ lock_type: "escutcheon_pin" }),
      saltoLock({ id: "lock-2", lock_type: "escutcheon" }),
    ]);

    const points = await provider.listAccessPoints(TENANT_ID);

    expect(points[0].supportedModes).to.deep.equal([
      AccessPointMode.AUTHORIZATION,
    ]);
    expect(points[1].supportedModes).to.deep.equal([]);
  });

  it("treats an IQ without otp_enabled as needing no activation", async () => {
    stubTenant([]);
    SaltoKsApiClient.prototype.getIqs.resolves([
      saltoIq({ otp_enabled: false }),
    ]);
    stubLocks([saltoLock({ lock_type: "escutcheon" })]);

    const [point] = await provider.listAccessPoints(TENANT_ID);

    expect(point.supportedModes).to.deep.equal([AccessPointMode.REMOTE]);
  });

  it("drops remote while Salto reports restore_required", async () => {
    stubTenant(activated);
    SaltoKsApiClient.prototype.getIqs.resolves([
      saltoIq({ restore_required: true }),
    ]);
    stubLocks([saltoLock({ lock_type: "escutcheon" })]);

    const [point] = await provider.listAccessPoints(TENANT_ID);

    expect(point.supportedModes).to.deep.equal([]);
  });

  it("keeps remote for guests while the activation is only degraded", async () => {
    stubTenant([{ ...activated[0], state: "degraded" }]);
    stubLocks([saltoLock({ lock_type: "escutcheon" })]);

    const [point] = await provider.listAccessPoints(TENANT_ID);

    expect(point.supportedModes).to.deep.equal([AccessPointMode.REMOTE]);
  });

  it("drops remote once the activation requires re-activation", async () => {
    stubTenant([{ ...activated[0], state: "reactivation_required" }]);
    stubLocks([saltoLock({ lock_type: "escutcheon" })]);

    const [point] = await provider.listAccessPoints(TENANT_ID);

    expect(point.supportedModes).to.deep.equal([]);
  });

  it("answers getSupportedModes for one access point from the same rule", async () => {
    stubTenant(activated);
    stubLocks([saltoLock({ lock_type: "escutcheon" })]);

    const modes = await provider.getSupportedModes(
      { externalId: LOCK_ID },
      TENANT_ID,
    );

    expect(modes).to.deep.equal([AccessPointMode.REMOTE]);
  });
});
