const { expect } = require("chai");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const TenantManager = require("../src/commons/data-managers/tenant-manager");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");
const clientRegistry = require("../src/commons/services/access/clients/access-client-registry");
const {
  forgetSaltoKsClients,
} = require("../src/commons/services/access/clients/salto-ks-clients");
const SecurityUtils = require("../src/commons/utilities/security-utils");
const SaltoKsIqActivationService = require("../src/commons/services/access/salto-ks-iq-activation-service");
const { AccessOpenError } = require("../src/errors/AccessOpenError");
const { createFakeMongoose } = require("./helpers/fake-mongoose");
const {
  FakeSaltoKsApiClient,
  FAKE_SITE_ID,
} = require("./helpers/fake-salto-ks-api-client");

const TENANT_ID = "tenant-1";
const IQ_ID = "5dfdc54e-8335-11f0-a2ed-6045bd92d38f";

/** The identity of `saltoApp()`, which its activation entries belong to. */
const IDENTITY = Object.freeze({
  siteId: FAKE_SITE_ID,
  username: "system-user@example.test",
  environment: "accept",
});

function saltoApp(overrides = {}) {
  return {
    type: "access",
    id: "salto-ks",
    active: true,
    clientId: "client-id",
    clientSecret: "client-secret",
    username: "system-user@example.test",
    password: "password",
    siteId: FAKE_SITE_ID,
    environment: "accept",
    iqActivations: [],
    ...overrides,
  };
}

/** The stored tenants, as the fake Tenant collection holds them. */
let tenants;

/**
 * Stores the tenant with the given Salto application: reads answer a copy of
 * what is stored at that moment, writes go through the update operators.
 * Its Salto client is the fake Connect API until {@link fakeClient} swaps it.
 */
function stubTenant(app) {
  forgetSaltoKsClients();
  sinon
    .stub(clientRegistry, "createClient")
    .callsFake(() => new FakeSaltoKsApiClient());
  tenants = createFakeMongoose({
    Tenant: [{ id: TENANT_ID, applications: [app] }],
  }).model("Tenant");
  sinon.stub(TenantManager, "getTenant").callsFake(async (id) => {
    const tenant = tenants.documents.find((candidate) => candidate.id === id);
    return tenant ? structuredClone(tenant) : null;
  });
  sinon
    .stub(TenantModel, "updateOne")
    .callsFake((filter, update, options) =>
      tenants.updateOne(filter, update, options),
    );
}

/**
 * The tenant's Salto client: the fake Connect API acting as the identity of
 * `saltoApp()`, with the IQ calls stubbed. After {@link stubTenant}.
 */
function fakeClient(overrides = {}) {
  const client = Object.assign(new FakeSaltoKsApiClient(), {
    getIqs: sinon.stub().resolves([]),
    getIqFirstSecret: sinon.stub().resolves("ABCDEFGHIJKLMNOP"),
    sendIqPinEmail: sinon.stub().resolves(),
    putIqPin: sinon.stub().resolves(),
    ...overrides,
  });
  forgetSaltoKsClients();
  clientRegistry.createClient.returns(client);
  return client;
}

/** The activation entries as stored now. */
function persistedActivations() {
  return tenants.documents[0].applications[0].iqActivations;
}

describe("SaltoKsIqActivationService.startActivation", () => {
  afterEach(() => {
    sinon.restore();
    forgetSaltoKsClients();
  });

  it("persists the encrypted first secret before triggering the PIN mail", async () => {
    stubTenant(saltoApp());
    let storedWhenMailed;
    fakeClient({
      sendIqPinEmail: sinon.stub().callsFake(async () => {
        storedWhenMailed = structuredClone(persistedActivations());
      }),
    });

    const result = await SaltoKsIqActivationService.startActivation(
      TENANT_ID,
      IQ_ID,
    );

    expect(result.state).to.equal("pending_pin");
    expect(storedWhenMailed).to.have.length(1);
    expect(storedWhenMailed[0].iqId).to.equal(IQ_ID);
    expect(SecurityUtils.decrypt(storedWhenMailed[0].secret)).to.equal(
      "ABCDEFGHIJKLMNOP",
    );

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
            ...IDENTITY,
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
    expect(TenantModel.updateOne.called).to.be.false;
  });

  it("refuses to start over an activated IQ", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [{ iqId: IQ_ID, ...IDENTITY, state: "activated" }],
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
    expect(persistedActivations()).to.deep.equal([]);
  });

  it("passes an unrelated 403 through instead of claiming an app legacy", async () => {
    stubTenant(saltoApp());
    const saltoError = new Error("permission denied");
    saltoError.response = { status: 403, data: { ErrorCode: 1403 } };
    fakeClient({ getIqFirstSecret: sinon.stub().rejects(saltoError) });

    try {
      await SaltoKsIqActivationService.startActivation(TENANT_ID, IQ_ID);
      throw new Error("expected startActivation to throw");
    } catch (err) {
      expect(err).to.equal(saltoError);
    }
  });
});

describe("SaltoKsIqActivationService.completeActivation", () => {
  beforeEach(() => {
    sinon.useFakeTimers({
      now: Date.UTC(2026, 7, 25, 7, 25, 0),
      toFake: ["Date"],
    });
  });

  afterEach(() => {
    sinon.restore();
    forgetSaltoKsClients();
  });

  function pendingApp() {
    return saltoApp({
      iqActivations: [
        {
          iqId: IQ_ID,
          ...IDENTITY,
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

  it("passes a non-OTP failure through instead of claiming a wrong PIN", async () => {
    stubTenant(pendingApp());
    const networkError = new Error("socket hang up");
    fakeClient({ putIqPin: sinon.stub().rejects(networkError) });

    try {
      await SaltoKsIqActivationService.completeActivation(
        TENANT_ID,
        IQ_ID,
        "1234",
      );
      throw new Error("expected completeActivation to throw");
    } catch (err) {
      expect(err).to.equal(networkError);
    }

    const [entry] = persistedActivations();
    expect(entry.state).to.equal("pending_pin");
    expect(entry.lastError).to.equal("socket hang up");
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
  afterEach(() => {
    sinon.restore();
    forgetSaltoKsClients();
  });

  it("removes the local entry without calling Salto", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [
          { iqId: IQ_ID, ...IDENTITY, state: "degraded" },
          { iqId: "other-iq", ...IDENTITY, state: "activated" },
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
      { iqId: "other-iq", ...IDENTITY, state: "activated" },
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
    sinon.useFakeTimers({
      now: Date.UTC(2026, 7, 25, 7, 25, 0),
      toFake: ["Date"],
    });
  });

  afterEach(() => {
    sinon.restore();
    forgetSaltoKsClients();
  });

  function activatedEntry(overrides = {}) {
    return {
      iqId: IQ_ID,
      ...IDENTITY,
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
    sinon.useFakeTimers({
      now: Date.UTC(2026, 7, 25, 7, 25, 0),
      toFake: ["Date"],
    });
  });

  afterEach(() => {
    sinon.restore();
    forgetSaltoKsClients();
  });

  function appWithEntry(overrides = {}) {
    return saltoApp({
      iqActivations: [
        {
          iqId: IQ_ID,
          ...IDENTITY,
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

/**
 * The other tests stub `TenantModel.updateOne`; these let the tenant model
 * cast the updates and their `arrayFilters` as it does in production, and
 * stub only the driver's collection behind it. No MongoDB runs: the cast
 * update is applied to the fake collection.
 */
describe("SaltoKsIqActivationService open bookkeeping through the tenant model's casting", () => {
  beforeEach(() => {
    sinon.useFakeTimers({
      now: Date.UTC(2026, 7, 25, 7, 25, 0),
      toFake: ["Date"],
    });
  });

  afterEach(() => {
    sinon.restore();
    forgetSaltoKsClients();
  });

  /** Like {@link stubTenant}, but the write passes the model's casting. */
  function storeTenant(entryOverrides = {}) {
    forgetSaltoKsClients();
    sinon
      .stub(clientRegistry, "createClient")
      .callsFake(() => new FakeSaltoKsApiClient());
    tenants = createFakeMongoose({
      Tenant: [
        {
          id: TENANT_ID,
          applications: [
            saltoApp({
              iqActivations: [
                {
                  iqId: IQ_ID,
                  ...IDENTITY,
                  secret: SecurityUtils.encrypt("ABCDEFGHIJKLMNOP"),
                  pin: SecurityUtils.encrypt("1234"),
                  state: "activated",
                  activatedAt: new Date(),
                  failureCount: 0,
                  blockedUntil: null,
                  lastError: null,
                  ...entryOverrides,
                },
              ],
            }),
          ],
        },
      ],
    }).model("Tenant");
    sinon.stub(TenantManager, "getTenant").callsFake(async (id) => {
      const tenant = tenants.documents.find((candidate) => candidate.id === id);
      return tenant ? structuredClone(tenant) : null;
    });
    sinon
      .stub(TenantModel.collection, "updateOne")
      .callsFake((filter, update, options) =>
        tenants.collection.updateOne(filter, update, options),
      );
  }

  it("degrades the activation after three otp_invalid in a row", async () => {
    storeTenant({ failureCount: 2 });

    await SaltoKsIqActivationService.recordOtpInvalid(
      TENANT_ID,
      IQ_ID,
      "otp_invalid",
    );

    const [entry] = persistedActivations();
    expect(entry).to.include({
      failureCount: 3,
      state: "degraded",
      lastError: "otp_invalid",
    });
  });

  it("backs off after otp_blocked", async () => {
    storeTenant();

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
  });
});

describe("SaltoKsIqActivationService open bookkeeping (reactivation)", () => {
  afterEach(() => {
    sinon.restore();
    forgetSaltoKsClients();
  });

  it("marks an activation as reactivation_required", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [
          { iqId: IQ_ID, ...IDENTITY, state: "activated", lastError: null },
        ],
      }),
    );

    await SaltoKsIqActivationService.markReactivationRequired(
      TENANT_ID,
      IQ_ID,
      "restore_required",
    );

    const [entry] = persistedActivations();
    expect(entry.state).to.equal("reactivation_required");
    expect(entry.lastError).to.equal("restore_required");
  });
});

describe("SaltoKsIqActivationService.redactActivations", () => {
  it("strips the activation entries from a tenant answer", () => {
    const tenant = {
      id: TENANT_ID,
      applications: [
        saltoApp({
          iqActivations: [{ iqId: IQ_ID, state: "activated" }],
        }),
        { type: "payment", id: "other" },
      ],
    };

    SaltoKsIqActivationService.redactActivations(tenant);

    expect(tenant.applications[0]).to.not.have.property("iqActivations");
    expect(tenant.applications[1]).to.deep.equal({
      type: "payment",
      id: "other",
    });
  });

  it("tolerates a tenant without applications", () => {
    expect(() =>
      SaltoKsIqActivationService.redactActivations(null),
    ).to.not.throw();
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
  afterEach(() => {
    sinon.restore();
    forgetSaltoKsClients();
  });

  it("merges the live IQ flags with the local activation state, without secrets", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [
          {
            iqId: IQ_ID,
            ...IDENTITY,
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
            ...IDENTITY,
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

describe("SaltoKsIqActivationService concurrent changes at different IQs", () => {
  const OTHER_IQ_ID = "7a1c3e5f-8335-11f0-a2ed-6045bd92d38f";

  beforeEach(() => {
    sinon.useFakeTimers({
      now: Date.UTC(2026, 7, 25, 7, 25, 0),
      toFake: ["Date"],
    });
  });

  afterEach(() => {
    sinon.restore();
    forgetSaltoKsClients();
  });

  function entry(iqId, overrides = {}) {
    return {
      iqId,
      ...IDENTITY,
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

  it("keeps both activations started at the same time", async () => {
    stubTenant(saltoApp());
    fakeClient({
      getIqFirstSecret: sinon
        .stub()
        .callsFake(async (iqId) =>
          iqId === IQ_ID ? "ABCDEFGHIJKLMNOP" : "QRSTUVWXYZABCDEF",
        ),
    });

    await Promise.all([
      SaltoKsIqActivationService.startActivation(TENANT_ID, IQ_ID),
      SaltoKsIqActivationService.startActivation(TENANT_ID, OTHER_IQ_ID),
    ]);

    const stored = persistedActivations();
    expect(stored.map((a) => [a.iqId, a.state])).to.have.deep.members([
      [IQ_ID, "pending_pin"],
      [OTHER_IQ_ID, "pending_pin"],
    ]);
    expect(
      SecurityUtils.decrypt(stored.find((a) => a.iqId === OTHER_IQ_ID).secret),
    ).to.equal("QRSTUVWXYZABCDEF");
  });

  it("keeps an activation completed while an open at another IQ is booked", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [
          entry(IQ_ID, { state: "pending_pin", pin: null }),
          entry(OTHER_IQ_ID),
        ],
      }),
    );
    fakeClient();

    await Promise.all([
      SaltoKsIqActivationService.completeActivation(TENANT_ID, IQ_ID, "1234"),
      SaltoKsIqActivationService.recordOtpBlocked(
        TENANT_ID,
        OTHER_IQ_ID,
        "otp_blocked",
      ),
    ]);

    const stored = persistedActivations();
    const completed = stored.find((a) => a.iqId === IQ_ID);
    const blocked = stored.find((a) => a.iqId === OTHER_IQ_ID);
    expect(completed.state).to.equal("activated");
    expect(SecurityUtils.decrypt(completed.pin)).to.equal("1234");
    expect(new Date(blocked.blockedUntil).toISOString()).to.equal(
      "2026-08-25T07:50:00.000Z",
    );
    expect(blocked.state).to.equal("activated");
  });

  it("keeps both bookings of opens at two IQs at the same time", async () => {
    stubTenant(
      saltoApp({
        iqActivations: [
          entry(IQ_ID, { failureCount: 2 }),
          entry(OTHER_IQ_ID, { state: "degraded", failureCount: 3 }),
        ],
      }),
    );

    await Promise.all([
      SaltoKsIqActivationService.recordOtpInvalid(
        TENANT_ID,
        IQ_ID,
        "otp_invalid",
      ),
      SaltoKsIqActivationService.recordOpenSuccess(TENANT_ID, OTHER_IQ_ID),
    ]);

    const stored = persistedActivations();
    const failed = stored.find((a) => a.iqId === IQ_ID);
    const opened = stored.find((a) => a.iqId === OTHER_IQ_ID);
    expect([failed.state, failed.failureCount]).to.deep.equal(["degraded", 3]);
    expect([opened.state, opened.failureCount]).to.deep.equal(["activated", 0]);
  });
});
