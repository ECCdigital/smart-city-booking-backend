const { expect } = require("chai");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  SaltoKsApiClient,
} = require("../src/commons/services/access/clients/salto-ks-api-client");
const {
  testProvider,
} = require("../src/commons/services/access/clients/access-test-registry");
const {
  installFakeSaltoKsConnectApi,
  FAKE_SITE_ID,
} = require("./helpers/fake-salto-ks-api-client");
require("../src/commons/services/access/clients");

const IQ_ID = "5dfdc54e-8335-11f0-a2ed-6045bd92d38f";

const CONFIG = {
  clientId: "client-id",
  clientSecret: "client-secret",
  siteId: "site-1",
  environment: "accept",
  username: "system-user@example.test",
  password: "password",
};

describe("Salto KS connection test", () => {
  beforeEach(() => {
    sinon
      .stub(SaltoKsApiClient, "testConnection")
      .resolves({ success: true, message: "Connection successful (accept)" });
    sinon
      .stub(SaltoKsApiClient.prototype, "getSiteMe")
      .resolves({ remote_access: true });
    sinon.stub(SaltoKsApiClient.prototype, "getIqs").resolves([
      {
        id: IQ_ID,
        customer_reference: "IQ 01",
        otp_enabled: true,
        online: true,
        restore_required: false,
      },
    ]);
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      applications: [
        {
          type: "access",
          id: "salto-ks",
          active: true,
          iqActivations: [
            {
              iqId: IQ_ID,
              secret: { iv: "iv", data: "data" },
              pin: { iv: "iv", data: "data" },
              state: "activated",
              activatedAt: null,
              lastError: null,
            },
          ],
        },
      ],
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it("reports remote_access and the activation state per IQ", async () => {
    const result = await testProvider("salto-ks", CONFIG, {
      tenantId: "tenant-1",
    });

    expect(result.success).to.be.true;
    expect(result.details.remoteAccess).to.equal(true);
    // The remote locking right cannot be asked for via the API (measured
    // 2026-08-18: the permission API answers 403) - the test says so instead
    // of pretending a check it cannot make.
    expect(result.details.remoteLockingRight).to.equal("not_verifiable");
    expect(result.details.iqs).to.deep.equal([
      {
        id: IQ_ID,
        customerReference: "IQ 01",
        otpEnabled: true,
        online: true,
        restoreRequired: false,
        state: "activated",
      },
    ]);
  });

  it("reports IQs as not_activated without a stored tenant application", async () => {
    TenantManager.getTenant.resolves(null);

    const result = await testProvider("salto-ks", CONFIG, {
      tenantId: "tenant-1",
    });

    expect(result.success).to.be.true;
    expect(result.details.iqs[0].state).to.equal("not_activated");
  });

  it("keeps the plain failure answer when the base test fails", async () => {
    SaltoKsApiClient.testConnection.resolves({
      success: false,
      message: "invalid_client",
    });

    const result = await testProvider("salto-ks", CONFIG, {
      tenantId: "tenant-1",
    });

    expect(result).to.deep.equal({ success: false, message: "invalid_client" });
    expect(SaltoKsApiClient.prototype.getSiteMe.called).to.be.false;
  });

  it("does not fail the test when the IQ overview cannot be fetched", async () => {
    SaltoKsApiClient.prototype.getSiteMe.rejects(new Error("boom"));

    const result = await testProvider("salto-ks", CONFIG, {
      tenantId: "tenant-1",
    });

    expect(result.success).to.be.true;
    expect(result.details.remoteAccess).to.equal(null);
  });
});

describe("Salto KS connection test with the stored secrets", () => {
  const STORED = {
    type: "access",
    id: "salto-ks",
    active: true,
    clientId: "client-id",
    clientSecret: "stored-client-secret",
    siteId: FAKE_SITE_ID,
    environment: "accept",
    username: "system-user@example.test",
    password: "stored-password",
    iqActivations: [],
  };

  const ACCOUNT = {
    environment: "accept",
    clientId: "client-id",
    clientSecret: "stored-client-secret",
    username: "system-user@example.test",
    password: "stored-password",
  };

  /** The form as the admin UI sends it: the identity, the secrets left empty. */
  function form(overrides = {}) {
    return {
      clientId: STORED.clientId,
      clientSecret: "",
      siteId: STORED.siteId,
      environment: STORED.environment,
      username: STORED.username,
      password: "",
      ...overrides,
    };
  }

  let salto;

  function storeTenant(app = STORED) {
    TenantManager.getTenant.resolves({
      id: "tenant-1",
      applications: app ? [app] : [],
    });
  }

  beforeEach(() => {
    sinon.stub(TenantManager, "getTenant");
    storeTenant();
    salto = installFakeSaltoKsConnectApi(sinon, {
      accounts: [ACCOUNT],
      locks: [{ id: "lock-1", iq_id: IQ_ID }],
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  async function test(config) {
    return testProvider("salto-ks", config, { tenantId: "tenant-1" });
  }

  it("tests with the stored secrets when the form leaves them empty", async () => {
    const result = await test(form());

    expect(result.success).to.be.true;
  });

  it("tests with the stored secrets when the form leaves them out", async () => {
    const config = form();
    delete config.clientSecret;
    delete config.password;

    const result = await test(config);

    expect(result.success).to.be.true;
  });

  it("tests a stored application that is not switched on yet", async () => {
    storeTenant({ ...STORED, active: false });

    const result = await test(form());

    expect(result.success).to.be.true;
  });

  it("needs no new secret when only the site changes", async () => {
    storeTenant({ ...STORED, siteId: "an-old-site" });

    const result = await test(form({ siteId: FAKE_SITE_ID }));

    expect(result.success).to.be.true;
  });

  it("takes the secrets the form names over the stored ones", async () => {
    const result = await test(
      form({ clientSecret: "wrong-secret", password: "stored-password" }),
    );

    expect(result).to.deep.equal({ success: false, message: "invalid_client" });
  });

  it("does not take the stored client secret for a new client id", async () => {
    const result = await test(form({ clientId: "other-client" }));

    expect(result).to.deep.include({
      success: false,
      code: "missing_secret",
      missing: [{ field: "clientSecret", reason: "client_id_changed" }],
    });
    expect(salto.logins).to.be.empty;
  });

  it("tests a new client id with the client secret from the form", async () => {
    salto = null;
    sinon.restore();
    sinon.stub(TenantManager, "getTenant");
    storeTenant();
    salto = installFakeSaltoKsConnectApi(sinon, {
      accounts: [
        { ...ACCOUNT, clientId: "other-client", clientSecret: "new-secret" },
      ],
    });

    const result = await test(
      form({ clientId: "other-client", clientSecret: "new-secret" }),
    );

    expect(result.success).to.be.true;
  });

  it("does not take the stored password for a new system user", async () => {
    const result = await test(form({ username: "other-user@example.test" }));

    expect(result).to.deep.include({
      success: false,
      code: "missing_secret",
      missing: [{ field: "password", reason: "username_changed" }],
    });
    expect(salto.logins).to.be.empty;
  });

  it("takes neither stored secret in another environment", async () => {
    const result = await test(form({ environment: "production" }));

    expect(result).to.deep.include({
      success: false,
      code: "missing_secret",
      missing: [
        { field: "clientSecret", reason: "environment_changed" },
        { field: "password", reason: "environment_changed" },
      ],
    });
    expect(salto.logins).to.be.empty;
  });

  it("reads a stored configuration without environment as accept", async () => {
    const legacy = { ...STORED };
    delete legacy.environment;
    storeTenant(legacy);

    const result = await test(form({ environment: "accept" }));

    expect(result.success).to.be.true;
  });

  it("names a secret that was never stored", async () => {
    storeTenant(null);

    const result = await test(form({ clientSecret: "stored-client-secret" }));

    expect(result).to.deep.include({
      success: false,
      code: "missing_secret",
      missing: [{ field: "password", reason: "not_stored" }],
    });
  });

  it("checks the other required fields as before", async () => {
    const result = await test(form({ clientId: "" }));

    expect(result).to.deep.equal({
      success: false,
      message: "Missing required fields: clientId",
    });
  });
});
