const { expect } = require("chai");
const sinon = require("sinon");
const axios = require("axios");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  testProvider,
} = require("../src/commons/services/access/clients/access-test-registry");
const {
  installFakeSaltoKsConnectApi,
  saltoHttpError,
  identityError,
  FAKE_SITE_ID,
} = require("./helpers/fake-salto-ks-api-client");
require("../src/commons/services/access/clients");

const IQ_ID = "5dfdc54e-8335-11f0-a2ed-6045bd92d38f";
const OTHER_SYSTEM_USER = "other-system-user@example.test";

const CONFIG = {
  clientId: "client-id",
  clientSecret: "client-secret",
  siteId: FAKE_SITE_ID,
  environment: "accept",
  username: "system-user@example.test",
  password: "password",
};

const ACCOUNT_OF_CONFIG = {
  environment: CONFIG.environment,
  clientId: CONFIG.clientId,
  clientSecret: CONFIG.clientSecret,
  username: CONFIG.username,
  password: CONFIG.password,
};

/** An axios timeout, as the 30 s of the client raise it. */
function timeoutError() {
  return Object.assign(new Error("timeout of 30000ms exceeded"), {
    isAxiosError: true,
    code: "ECONNABORTED",
  });
}

describe("Salto KS connection test", () => {
  let salto;

  beforeEach(() => {
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
              siteId: FAKE_SITE_ID,
              username: "system-user@example.test",
              environment: "accept",
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
    salto = installFakeSaltoKsConnectApi(sinon, {
      accounts: [
        ACCOUNT_OF_CONFIG,
        { ...ACCOUNT_OF_CONFIG, username: OTHER_SYSTEM_USER },
      ],
      locks: [
        { id: "lock-1", iq_id: IQ_ID },
        { id: "lock-2", iq_id: IQ_ID },
      ],
      iqs: [
        {
          id: IQ_ID,
          customer_reference: "IQ 01",
          otp_enabled: true,
          online: true,
          restore_required: false,
        },
      ],
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  async function test(config = CONFIG) {
    return testProvider("salto-ks", config, { tenantId: "tenant-1" });
  }

  it("reports remote_access and the activation state per IQ", async () => {
    const result = await test();

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

  it("reports the activation state of the identity under test", async () => {
    const result = await testProvider(
      "salto-ks",
      { ...CONFIG, username: OTHER_SYSTEM_USER },
      { tenantId: "tenant-1" },
    );

    expect(result.success).to.be.true;
    expect(result.details.iqs[0].state).to.equal("not_activated");
  });

  it("reports IQs as not_activated without a stored tenant application", async () => {
    TenantManager.getTenant.resolves(null);

    const result = await test();

    expect(result.success).to.be.true;
    expect(result.details.iqs[0].state).to.equal("not_activated");
  });

  it("answers every check ok for a working setup", async () => {
    const result = await test();

    expect(result.checks).to.deep.equal({
      credentials: { status: "ok" },
      login: { status: "ok" },
      site: { status: "ok", locks: 2 },
      remoteAccess: { status: "ok" },
      remoteLockingRight: { status: "not_verifiable" },
      iqs: { status: "ok" },
    });
    expect(result.environment).to.equal("accept");
    expect(result.message).to.equal("Connection successful (accept)");
  });

  it("says when it tested", async () => {
    const before = Date.now();

    const result = await test();

    const testedAt = Date.parse(result.testedAt);
    expect(result.testedAt).to.equal(new Date(testedAt).toISOString());
    expect(testedAt).to.be.within(before, Date.now());
  });

  it("says the secrets of the form were tested", async () => {
    const result = await test();

    expect(result.testedWith).to.deep.equal({
      clientSecret: "form",
      password: "form",
    });
  });

  it("names a rejected client as invalid_client and skips the rest", async () => {
    const result = await test({ ...CONFIG, clientSecret: "wrong" });

    expect(result.success).to.be.false;
    expect(result.checks).to.deep.equal({
      credentials: { status: "failed", code: "invalid_client" },
      login: { status: "skipped" },
      site: { status: "skipped" },
      remoteAccess: { status: "skipped" },
      remoteLockingRight: { status: "not_verifiable" },
      iqs: { status: "skipped" },
    });
    expect(result).not.to.have.property("details");
  });

  it("names a rejected system user as invalid_grant behind a valid client", async () => {
    const result = await test({ ...CONFIG, password: "wrong" });

    expect(result.success).to.be.false;
    expect(result.checks).to.deep.include({
      credentials: { status: "ok" },
      login: { status: "failed", code: "invalid_grant" },
      site: { status: "skipped" },
      remoteAccess: { status: "skipped" },
      iqs: { status: "skipped" },
    });
  });

  it("names an identity server that does not answer as timeout", async () => {
    salto.failures.token = timeoutError();

    const result = await test();

    expect(result.success).to.be.false;
    expect(result.checks.credentials).to.deep.equal({
      status: "failed",
      code: "timeout",
    });
    expect(result.checks.login).to.deep.equal({ status: "skipped" });
  });

  it("keeps a token failure without code as failed credentials", async () => {
    salto.failures.token = identityError("unauthorized_client");

    const result = await test();

    expect(result.checks.credentials).to.deep.equal({ status: "failed" });
    expect(result.message).to.equal("unauthorized_client");
  });

  it("names a site the system user may not read as site_forbidden", async () => {
    salto.failures["/locks"] = saltoHttpError(403, { Message: "Forbidden" });

    const result = await test();

    expect(result.success).to.be.false;
    expect(result.checks).to.deep.include({
      credentials: { status: "ok" },
      login: { status: "ok" },
      site: { status: "failed", code: "site_forbidden" },
      remoteAccess: { status: "skipped" },
      iqs: { status: "skipped" },
    });
  });

  it("names a site reference Salto does not list as site_forbidden", async () => {
    const result = await test({ ...CONFIG, siteId: "Keller" });

    expect(result.success).to.be.false;
    expect(result.checks.site).to.deep.equal({
      status: "failed",
      code: "site_forbidden",
    });
  });

  it("resolves a site reference Salto lists", async () => {
    const result = await test({ ...CONFIG, siteId: "Labor" });

    expect(result.success).to.be.true;
    expect(result.checks.site).to.deep.equal({ status: "ok", locks: 2 });
  });

  it("names a site that does not answer as timeout", async () => {
    salto.failures["/locks"] = timeoutError();

    const result = await test();

    expect(result.checks.site).to.deep.equal({
      status: "failed",
      code: "timeout",
    });
  });

  it("keeps another failure of the site without code", async () => {
    salto.failures["/locks"] = saltoHttpError(500, {
      Message: "Internal error",
    });

    const result = await test();

    expect(result.checks.site).to.deep.equal({ status: "failed" });
    expect(result.message).to.equal("Internal error");
  });

  it("names a missing site as site_missing", async () => {
    const result = await test({ ...CONFIG, siteId: "" });

    expect(result.success).to.be.false;
    expect(result.checks).to.deep.include({
      credentials: { status: "ok" },
      login: { status: "ok" },
      site: { status: "failed", code: "site_missing" },
      remoteAccess: { status: "skipped" },
      iqs: { status: "skipped" },
    });
  });

  it("names a system user without remote access as remote_access_off and stays connected", async () => {
    salto.site.me = { remote_access: false };

    const result = await test();

    expect(result.success).to.be.true;
    expect(result.checks.remoteAccess).to.deep.equal({
      status: "failed",
      code: "remote_access_off",
    });
  });

  it("answers remote access unknown when Salto does not say", async () => {
    salto.site.me = {};

    const result = await test();

    expect(result.success).to.be.true;
    expect(result.checks.remoteAccess).to.deep.equal({ status: "unknown" });
  });

  it("answers remote access unknown when /me fails, and stays connected", async () => {
    salto.failures["/me"] = saltoHttpError(500, { Message: "boom" });

    const result = await test();

    expect(result.success).to.be.true;
    expect(result.checks.remoteAccess).to.deep.equal({ status: "unknown" });
    expect(result.details.remoteAccess).to.equal(null);
  });

  it("answers the IQs unknown when Salto does not list them, and stays connected", async () => {
    salto.failures["/iqs"] = saltoHttpError(500, { Message: "boom" });

    const result = await test();

    expect(result.success).to.be.true;
    expect(result.checks.iqs).to.deep.equal({ status: "unknown" });
    expect(result.details.iqs).to.deep.equal([]);
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
    expect(result.testedWith).to.deep.equal({
      clientSecret: "stored",
      password: "stored",
    });
  });

  it("says per secret where it came from", async () => {
    const result = await test(form({ password: "stored-password" }));

    expect(result.testedWith).to.deep.equal({
      clientSecret: "stored",
      password: "form",
    });
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

    expect(result.success).to.be.false;
    expect(result.checks.credentials).to.deep.equal({
      status: "failed",
      code: "invalid_client",
    });
    expect(result.testedWith).to.deep.equal({
      clientSecret: "form",
      password: "form",
    });
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

describe("Salto KS connection test over the real transport", () => {
  beforeEach(() => {
    sinon.stub(TenantManager, "getTenant").resolves(null);
  });

  afterEach(() => {
    sinon.restore();
  });

  function rejectWith(status, data) {
    const err = new Error(`Request failed with status code ${status}`);
    err.response = { status, data };
    sinon.stub(axios, "request").rejects(err);
  }

  async function test(config = {}) {
    return testProvider(
      "salto-ks",
      { ...CONFIG, siteId: "", ...config },
      { tenantId: "tenant-1" },
    );
  }

  it("keeps the identity server's error in the message, next to the code", async () => {
    rejectWith(400, {
      error: "invalid_client",
      error_description: "Client authentication failed",
    });

    const result = await test();

    expect(result.success).to.be.false;
    expect(result.message).to.equal(
      "invalid_client: Client authentication failed",
    );
    expect(result.checks.credentials).to.deep.equal({
      status: "failed",
      code: "invalid_client",
    });
  });

  it("falls back to the shared status mapping when there is no body", async () => {
    rejectWith(401, "");

    const result = await test();

    expect(result.message).to.equal("Invalid credentials");
    expect(result.checks.credentials).to.deep.equal({ status: "failed" });
  });

  it("signs in at the identity server of the environment", async () => {
    sinon
      .stub(axios, "request")
      .resolves({ data: { access_token: "t", expires_in: 3600 } });

    const result = await test({ environment: "production" });

    expect(result.environment).to.equal("production");
    expect(result.checks.login).to.deep.equal({ status: "ok" });
    expect(axios.request.firstCall.args[0].url).to.equal(
      "https://identity.eu.my-clay.com/connect/token",
    );
  });
});
