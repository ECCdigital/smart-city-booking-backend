const { expect } = require("chai");
const sinon = require("sinon");

const {
  TenantController,
} = require("../src/platform/api/controllers/tenant-controller");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const Tenant = require("../src/commons/entities/tenant/tenant");
const AccessInfoService = require("../src/commons/services/access/access-info-service");
const {
  SaltoKsApiClient,
} = require("../src/commons/services/access/clients/salto-ks-api-client");

const SITE_ID = "8f6a4d2e-0b1c-4d3e-9a7b-1c2d3e4f5a6b";
const WEBHOOK_CAPABILITIES = [
  "registerWebhook",
  "unregisterWebhook",
  "parseWebhook",
  "verifyWebhookSignature",
];

function saltoApp(overrides = {}) {
  return {
    type: "access",
    id: "salto-ks",
    title: "Salto KS",
    active: true,
    clientId: "client-id",
    clientSecret: "client-secret",
    siteId: SITE_ID,
    username: "system-user@example.test",
    password: "password",
    environment: "accept",
    ...overrides,
  };
}

function response(sandbox) {
  return {
    status: sandbox.stub().returnsThis(),
    send: sandbox.stub().returnsThis(),
    sendStatus: sandbox.stub().returnsThis(),
  };
}

// Salto KS has no webhooks: the Connect API offers no subscriptions.
describe("Salto KS without webhooks", function () {
  let sandbox;
  let saltoRequests;
  let previousBackendUrl;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    saltoRequests = [];
    sandbox.stub(SaltoKsApiClient.prototype, "_getToken").resolves("token");
    sandbox
      .stub(SaltoKsApiClient.prototype, "_request")
      .callsFake(async (method, path) => {
        saltoRequests.push(`${method.toUpperCase()} ${path}`);
        return {};
      });
    previousBackendUrl = process.env.BACKEND_URL;
    process.env.BACKEND_URL = "https://backend.example.test";
  });

  afterEach(function () {
    sandbox.restore();
    if (previousBackendUrl === undefined) {
      delete process.env.BACKEND_URL;
    } else {
      process.env.BACKEND_URL = previousBackendUrl;
    }
  });

  it("saving a tenant with Salto KS active sends nothing to Salto and stores no webhook registration", async function () {
    const tenant = new Tenant({
      id: "tenant-1",
      name: "Tenant",
      applications: [saltoApp()],
    });
    sandbox.stub(TenantManager, "getTenant").resolves(tenant);
    const storeTenant = sandbox
      .stub(TenantManager, "storeTenant")
      .callsFake(async (value) => value);
    const res = response(sandbox);

    await TenantController.updateTenant(
      {
        user: { id: "admin-1" },
        body: { id: "tenant-1", applications: [saltoApp()] },
      },
      res,
    );

    expect(res.status.calledWith(200)).to.equal(true);
    expect(saltoRequests).to.deep.equal([]);
    const stored = storeTenant.firstCall.args[0].applications.find(
      (app) => app.id === "salto-ks",
    );
    expect(stored.webhookSubscriptionId ?? null).to.equal(null);
    expect(stored.webhookRegisteredAt ?? null).to.equal(null);
    expect(stored.webhookRegistrationError ?? null).to.equal(null);
  });

  it("the list of active providers names no webhook capability and no client capabilities for Salto KS", async function () {
    sandbox.stub(TenantManager, "getTenant").resolves(
      new Tenant({
        id: "tenant-1",
        name: "Tenant",
        applications: [saltoApp()],
      }),
    );

    const [salto] = await AccessInfoService.getActiveProviders("tenant-1");

    expect(salto.id).to.equal("salto-ks");
    expect(salto.capabilities).to.deep.equal([]);
    for (const capability of WEBHOOK_CAPABILITIES) {
      expect(salto.providerCapabilities).not.to.include(capability);
    }
    expect(salto.providerCapabilities).to.include.members([
      "open",
      "getStatus",
      "listAccessPoints",
      "getSupportedModes",
    ]);
  });
});
