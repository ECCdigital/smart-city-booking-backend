const { expect } = require("chai");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const TenantManager = require("../src/commons/data-managers/tenant-manager");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");
const clientRegistry = require("../src/commons/services/access/clients/access-client-registry");
const SecurityUtils = require("../src/commons/utilities/security-utils");
const SaltoKsIqActivationService = require("../src/commons/services/access/salto-ks-iq-activation-service");
const { AccessOpenError } = require("../src/errors/AccessOpenError");

const TENANT_ID = "tenant-1";
const IQ_ID = "5dfdc54e-8335-11f0-a2ed-6045bd92d38f";

function saltoApp(overrides = {}) {
  return {
    type: "access",
    id: "salto-ks",
    active: true,
    clientId: "client-id",
    clientSecret: "client-secret",
    username: "system-user@example.test",
    password: "password",
    siteId: "site-1",
    environment: "accept",
    iqActivations: [],
    ...overrides,
  };
}

function stubTenant(app) {
  sinon
    .stub(TenantManager, "getTenant")
    .resolves({ id: TENANT_ID, applications: [app] });
}

function fakeClient(overrides = {}) {
  const client = {
    getIqs: sinon.stub().resolves([]),
    getIqFirstSecret: sinon.stub().resolves("ABCDEFGHIJKLMNOP"),
    sendIqPinEmail: sinon.stub().resolves(),
    putIqPin: sinon.stub().resolves(),
    ...overrides,
  };
  sinon.stub(clientRegistry, "createClient").returns(client);
  return client;
}

function persistedActivations() {
  const updates = TenantModel.updateOne
    .getCalls()
    .map((call) => call.args[1].$set["applications.$.iqActivations"]);
  return updates[updates.length - 1];
}

describe("SaltoKsIqActivationService.startActivation", () => {
  let updateOne;

  beforeEach(() => {
    updateOne = sinon.stub(TenantModel, "updateOne").resolves();
  });

  afterEach(() => {
    sinon.restore();
  });

  it("persists the encrypted first secret before triggering the PIN mail", async () => {
    stubTenant(saltoApp());
    const client = fakeClient();

    const result = await SaltoKsIqActivationService.startActivation(
      TENANT_ID,
      IQ_ID,
    );

    expect(result.state).to.equal("pending_pin");
    expect(updateOne.calledOnce).to.be.true;
    expect(updateOne.calledBefore(client.sendIqPinEmail)).to.be.true;
    expect(updateOne.firstCall.args[0]).to.deep.equal({
      id: TENANT_ID,
      applications: { $elemMatch: { type: "access", id: "salto-ks" } },
    });

    const [entry] = persistedActivations();
    expect(entry.iqId).to.equal(IQ_ID);
    expect(entry.state).to.equal("pending_pin");
    expect(SecurityUtils.decrypt(entry.secret)).to.equal("ABCDEFGHIJKLMNOP");
    expect(entry.pin).to.equal(null);
  });

  it("only repeats the PIN mail while a secret is already stored", async () => {
    const storedSecret = SecurityUtils.encrypt("ABCDEFGHIJKLMNOP");
    stubTenant(
      saltoApp({
        iqActivations: [
          {
            iqId: IQ_ID,
            secret: storedSecret,
            pin: null,
            state: "pending_pin",
          },
        ],
      }),
    );
    const client = fakeClient();

    const result = await SaltoKsIqActivationService.startActivation(
      TENANT_ID,
      IQ_ID,
    );

    expect(result.state).to.equal("pending_pin");
    expect(client.getIqFirstSecret.called).to.be.false;
    expect(client.sendIqPinEmail.calledOnceWith(IQ_ID)).to.be.true;
    expect(updateOne.called).to.be.false;
  });

  it("refuses to start over an activated IQ", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [{ iqId: IQ_ID, state: "activated" }],
      }),
    );
    fakeClient();

    try {
      await SaltoKsIqActivationService.startActivation(TENANT_ID, IQ_ID);
      throw new Error("expected startActivation to throw");
    } catch (err) {
      expect(err.code).to.equal("salto_iq_activation_exists");
    }
  });

  it("keeps the stored secret when the PIN mail fails", async () => {
    stubTenant(saltoApp());
    const mailError = new Error("mail refused");
    const client = fakeClient({
      sendIqPinEmail: sinon.stub().rejects(mailError),
    });

    try {
      await SaltoKsIqActivationService.startActivation(TENANT_ID, IQ_ID);
      throw new Error("expected startActivation to throw");
    } catch (err) {
      expect(err).to.equal(mailError);
    }

    const [entry] = persistedActivations();
    expect(entry.state).to.equal("pending_pin");
    expect(entry.lastError).to.equal("mail refused");
    expect(SecurityUtils.decrypt(entry.secret)).to.equal("ABCDEFGHIJKLMNOP");
    expect(client.getIqFirstSecret.calledOnce).to.be.true;
  });

  it("reports an IQ the system user already activated elsewhere (403 from Salto)", async () => {
    stubTenant(saltoApp());
    const saltoError = new Error(
      "Cannot get first secret for an already activated Iq.",
    );
    saltoError.response = { status: 403, data: { ErrorCode: 2203 } };
    fakeClient({ getIqFirstSecret: sinon.stub().rejects(saltoError) });

    try {
      await SaltoKsIqActivationService.startActivation(TENANT_ID, IQ_ID);
      throw new Error("expected startActivation to throw");
    } catch (err) {
      expect(err.code).to.equal("salto_iq_already_activated_at_salto");
    }
    expect(TenantModel.updateOne.called).to.be.false;
  });
});

describe("SaltoKsIqActivationService.completeActivation", () => {
  beforeEach(() => {
    sinon.stub(TenantModel, "updateOne").resolves();
    sinon.useFakeTimers({
      now: Date.UTC(2026, 7, 25, 7, 25, 0),
      toFake: ["Date"],
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  function pendingApp() {
    return saltoApp({
      iqActivations: [
        {
          iqId: IQ_ID,
          secret: SecurityUtils.encrypt("ABCDEFGHIJKLMNOP"),
          pin: null,
          state: "pending_pin",
          activatedAt: null,
          failureCount: 0,
          blockedUntil: null,
          lastError: null,
        },
      ],
    });
  }

  it("activates with a self-computed OTP and an unchanged pin (delta 0000)", async () => {
    stubTenant(pendingApp());
    const client = fakeClient();

    const result = await SaltoKsIqActivationService.completeActivation(
      TENANT_ID,
      IQ_ID,
      "1234",
    );

    // "28a5a" is the independently computed MD5 head for this fixed second,
    // secret and pin (see salto-ks-otp.test.js).
    expect(client.putIqPin.calledOnce).to.be.true;
    expect(client.putIqPin.firstCall.args[0]).to.equal(IQ_ID);
    expect(client.putIqPin.firstCall.args[1]).to.deep.equal({
      otp: "28a5a",
      delta: "0000",
    });

    expect(result.state).to.equal("activated");
    const [entry] = persistedActivations();
    expect(entry.state).to.equal("activated");
    expect(SecurityUtils.decrypt(entry.pin)).to.equal("1234");
    expect(SecurityUtils.decrypt(entry.secret)).to.equal("ABCDEFGHIJKLMNOP");
    expect(entry.activatedAt).to.not.equal(null);
    expect(entry.failureCount).to.equal(0);
    expect(entry.lastError).to.equal(null);
  });

  it("stays pending when Salto rejects the OTP, and reports the rejection", async () => {
    stubTenant(pendingApp());
    const saltoError = new Error("otp_invalid");
    saltoError.response = { status: 400, data: { ErrorCode: 3102 } };
    fakeClient({ putIqPin: sinon.stub().rejects(saltoError) });

    try {
      await SaltoKsIqActivationService.completeActivation(
        TENANT_ID,
        IQ_ID,
        "9999",
      );
      throw new Error("expected completeActivation to throw");
    } catch (err) {
      expect(err.code).to.equal("salto_iq_activation_otp_rejected");
    }

    const [entry] = persistedActivations();
    expect(entry.state).to.equal("pending_pin");
    expect(entry.pin).to.equal(null);
    expect(entry.lastError).to.equal("otp_invalid");
  });

  it("refuses a pin that is not four digits", async () => {
    stubTenant(pendingApp());
    fakeClient();

    try {
      await SaltoKsIqActivationService.completeActivation(
        TENANT_ID,
        IQ_ID,
        "12a4",
      );
      throw new Error("expected completeActivation to throw");
    } catch (err) {
      expect(err.code).to.equal("salto_iq_invalid_pin");
    }
  });

  it("refuses to complete an activation that was never started", async () => {
    stubTenant(saltoApp());
    fakeClient();

    try {
      await SaltoKsIqActivationService.completeActivation(
        TENANT_ID,
        IQ_ID,
        "1234",
      );
      throw new Error("expected completeActivation to throw");
    } catch (err) {
      expect(err.code).to.equal("salto_iq_activation_not_started");
    }
  });
});

describe("SaltoKsIqActivationService.discardActivation", () => {
  beforeEach(() => {
    sinon.stub(TenantModel, "updateOne").resolves();
  });

  afterEach(() => {
    sinon.restore();
  });

  it("removes the local entry without calling Salto", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [
          { iqId: IQ_ID, state: "degraded" },
          { iqId: "other-iq", state: "activated" },
        ],
      }),
    );
    const client = fakeClient();

    const result = await SaltoKsIqActivationService.discardActivation(
      TENANT_ID,
      IQ_ID,
    );

    expect(result.state).to.equal("not_activated");
    expect(persistedActivations()).to.deep.equal([
      { iqId: "other-iq", state: "activated" },
    ]);
    expect(client.getIqs.called).to.be.false;
    expect(client.putIqPin.called).to.be.false;
  });

  it("is idempotent for an IQ without an entry", async () => {
    stubTenant(saltoApp());
    fakeClient();

    const result = await SaltoKsIqActivationService.discardActivation(
      TENANT_ID,
      IQ_ID,
    );

    expect(result.state).to.equal("not_activated");
    expect(TenantModel.updateOne.called).to.be.false;
  });
});

describe("SaltoKsIqActivationService.resolveOtpForOpen", () => {
  beforeEach(() => {
    sinon.stub(TenantModel, "updateOne").resolves();
    sinon.useFakeTimers({
      now: Date.UTC(2026, 7, 25, 7, 25, 0),
      toFake: ["Date"],
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  function activatedEntry(overrides = {}) {
    return {
      iqId: IQ_ID,
      secret: SecurityUtils.encrypt("ABCDEFGHIJKLMNOP"),
      pin: SecurityUtils.encrypt("1234"),
      state: "activated",
      activatedAt: new Date(),
      failureCount: 0,
      blockedUntil: null,
      lastError: null,
      ...overrides,
    };
  }

  async function expectOpenError(promise, failureClass) {
    try {
      await promise;
      throw new Error("expected resolveOtpForOpen to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(AccessOpenError);
      expect(err.failureClass).to.equal(failureClass);
    }
  }

  it("computes the OTP from the stored ingredients of an activated IQ", async () => {
    stubTenant(saltoApp({ iqActivations: [activatedEntry()] }));

    const result = await SaltoKsIqActivationService.resolveOtpForOpen(
      TENANT_ID,
      { id: IQ_ID, otp_enabled: true },
    );

    expect(result.otp).to.equal("28a5a");
  });

  it("needs no OTP at an IQ without otp_enabled", async () => {
    stubTenant(saltoApp());

    const result = await SaltoKsIqActivationService.resolveOtpForOpen(
      TENANT_ID,
      { id: IQ_ID, otp_enabled: false },
    );

    expect(result.otp).to.equal(null);
  });

  it("refuses locally as a configuration failure when the IQ is not activated", async () => {
    stubTenant(saltoApp());

    await expectOpenError(
      SaltoKsIqActivationService.resolveOtpForOpen(TENANT_ID, {
        id: IQ_ID,
        otp_enabled: true,
      }),
      "configuration",
    );
  });

  it("refuses locally while the activation is pending the PIN", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [activatedEntry({ state: "pending_pin", pin: null })],
      }),
    );

    await expectOpenError(
      SaltoKsIqActivationService.resolveOtpForOpen(TENANT_ID, {
        id: IQ_ID,
        otp_enabled: true,
      }),
      "configuration",
    );
  });

  it("refuses locally while the IQ needs re-activation", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [activatedEntry({ state: "reactivation_required" })],
      }),
    );

    await expectOpenError(
      SaltoKsIqActivationService.resolveOtpForOpen(TENANT_ID, {
        id: IQ_ID,
        otp_enabled: true,
      }),
      "configuration",
    );
  });

  it("refuses locally as temporary while the IQ is blocked after otp_blocked", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [
          activatedEntry({
            blockedUntil: new Date(Date.now() + 10 * 60 * 1000),
          }),
        ],
      }),
    );

    await expectOpenError(
      SaltoKsIqActivationService.resolveOtpForOpen(TENANT_ID, {
        id: IQ_ID,
        otp_enabled: true,
      }),
      "temporary",
    );
  });

  it("still opens for guests while the activation is only degraded", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [activatedEntry({ state: "degraded", failureCount: 3 })],
      }),
    );

    const result = await SaltoKsIqActivationService.resolveOtpForOpen(
      TENANT_ID,
      { id: IQ_ID, otp_enabled: true },
    );

    expect(result.otp).to.equal("28a5a");
  });

  it("opens again once an expired block has passed", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [
          activatedEntry({
            blockedUntil: new Date(Date.now() - 1000),
          }),
        ],
      }),
    );

    const result = await SaltoKsIqActivationService.resolveOtpForOpen(
      TENANT_ID,
      { id: IQ_ID, otp_enabled: true },
    );

    expect(result.otp).to.equal("28a5a");
  });
});

describe("SaltoKsIqActivationService open bookkeeping", () => {
  beforeEach(() => {
    sinon.stub(TenantModel, "updateOne").resolves();
    sinon.useFakeTimers({
      now: Date.UTC(2026, 7, 25, 7, 25, 0),
      toFake: ["Date"],
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  function appWithEntry(overrides = {}) {
    return saltoApp({
      iqActivations: [
        {
          iqId: IQ_ID,
          secret: SecurityUtils.encrypt("ABCDEFGHIJKLMNOP"),
          pin: SecurityUtils.encrypt("1234"),
          state: "activated",
          activatedAt: new Date(),
          failureCount: 0,
          blockedUntil: null,
          lastError: null,
          ...overrides,
        },
      ],
    });
  }

  it("counts consecutive otp_invalid failures", async () => {
    stubTenant(appWithEntry({ failureCount: 1 }));

    await SaltoKsIqActivationService.recordOtpInvalid(
      TENANT_ID,
      IQ_ID,
      "otp_invalid",
    );

    const [entry] = persistedActivations();
    expect(entry.failureCount).to.equal(2);
    expect(entry.state).to.equal("activated");
    expect(entry.lastError).to.equal("otp_invalid");
  });

  it("degrades the activation after three otp_invalid in a row", async () => {
    stubTenant(appWithEntry({ failureCount: 2 }));

    await SaltoKsIqActivationService.recordOtpInvalid(
      TENANT_ID,
      IQ_ID,
      "otp_invalid",
    );

    const [entry] = persistedActivations();
    expect(entry.failureCount).to.equal(3);
    expect(entry.state).to.equal("degraded");
  });

  it("backs off 25 minutes after otp_blocked without a state change", async () => {
    stubTenant(appWithEntry());

    await SaltoKsIqActivationService.recordOtpBlocked(
      TENANT_ID,
      IQ_ID,
      "otp_blocked",
    );

    const [entry] = persistedActivations();
    expect(new Date(entry.blockedUntil).toISOString()).to.equal(
      new Date(Date.UTC(2026, 7, 25, 7, 50, 0)).toISOString(),
    );
    expect(entry.state).to.equal("activated");
    expect(entry.lastError).to.equal("otp_blocked");
  });

  it("resets the failure count and heals a degraded activation on success", async () => {
    stubTenant(appWithEntry({ state: "degraded", failureCount: 3 }));

    await SaltoKsIqActivationService.recordOpenSuccess(TENANT_ID, IQ_ID);

    const [entry] = persistedActivations();
    expect(entry.failureCount).to.equal(0);
    expect(entry.state).to.equal("activated");
    expect(entry.lastError).to.equal(null);
  });
});

describe("SaltoKsIqActivationService.preserveActivations", () => {
  it("keeps the stored activations regardless of what a tenant update sends", () => {
    const stored = [{ iqId: IQ_ID, state: "activated" }];
    const previousTenant = {
      id: TENANT_ID,
      applications: [saltoApp({ iqActivations: stored })],
    };
    const nextTenant = {
      id: TENANT_ID,
      applications: [saltoApp({ iqActivations: undefined })],
    };

    SaltoKsIqActivationService.preserveActivations(previousTenant, nextTenant);

    expect(nextTenant.applications[0].iqActivations).to.deep.equal(stored);
  });

  it("clears activations a client tries to smuggle in", () => {
    const previousTenant = { id: TENANT_ID, applications: [saltoApp()] };
    const nextTenant = {
      id: TENANT_ID,
      applications: [
        saltoApp({ iqActivations: [{ iqId: IQ_ID, state: "activated" }] }),
      ],
    };

    SaltoKsIqActivationService.preserveActivations(previousTenant, nextTenant);

    expect(nextTenant.applications[0].iqActivations).to.deep.equal([]);
  });

  it("leaves a tenant without a Salto application alone", () => {
    const nextTenant = { id: TENANT_ID, applications: [] };

    SaltoKsIqActivationService.preserveActivations(null, nextTenant);

    expect(nextTenant.applications).to.deep.equal([]);
  });
});

describe("SaltoKsIqActivationService.listIqs", () => {
  beforeEach(() => {
    sinon.stub(TenantModel, "updateOne").resolves();
  });

  afterEach(() => {
    sinon.restore();
  });

  it("merges the live IQ flags with the local activation state, without secrets", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [
          {
            iqId: IQ_ID,
            secret: SecurityUtils.encrypt("ABCDEFGHIJKLMNOP"),
            pin: SecurityUtils.encrypt("1234"),
            state: "activated",
            activatedAt: new Date("2026-08-25T07:30:00Z"),
            failureCount: 0,
            blockedUntil: null,
            lastError: null,
          },
        ],
      }),
    );
    fakeClient({
      getIqs: sinon.stub().resolves({
        items: [
          {
            id: IQ_ID,
            customer_reference: "IQ 01",
            otp_enabled: true,
            online: true,
            restore_required: false,
          },
          {
            id: "iq-2",
            customer_reference: "IQ 02",
            otp_enabled: false,
            online: false,
            restore_required: false,
          },
        ],
      }),
    });

    const iqs = await SaltoKsIqActivationService.listIqs(TENANT_ID);

    expect(iqs).to.deep.equal([
      {
        id: IQ_ID,
        customerReference: "IQ 01",
        otpEnabled: true,
        online: true,
        restoreRequired: false,
        state: "activated",
        activatedAt: new Date("2026-08-25T07:30:00Z"),
        lastError: null,
      },
      {
        id: "iq-2",
        customerReference: "IQ 02",
        otpEnabled: false,
        online: false,
        restoreRequired: false,
        state: "not_activated",
        activatedAt: null,
        lastError: null,
      },
    ]);
  });

  it("marks an activated IQ that Salto reports as restore_required", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [
          {
            iqId: IQ_ID,
            secret: SecurityUtils.encrypt("ABCDEFGHIJKLMNOP"),
            pin: SecurityUtils.encrypt("1234"),
            state: "activated",
            activatedAt: null,
            failureCount: 0,
            blockedUntil: null,
            lastError: null,
          },
        ],
      }),
    );
    fakeClient({
      getIqs: sinon.stub().resolves([
        {
          id: IQ_ID,
          customer_reference: "IQ 01",
          otp_enabled: true,
          online: true,
          restore_required: true,
        },
      ]),
    });

    const iqs = await SaltoKsIqActivationService.listIqs(TENANT_ID);

    expect(iqs[0].state).to.equal("reactivation_required");
    const [entry] = persistedActivations();
    expect(entry.state).to.equal("reactivation_required");
  });
});
