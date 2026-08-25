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
    // §9: the remote locking right cannot be asked for via the API - the test
    // says so instead of pretending a check it cannot make.
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
