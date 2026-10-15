const { expect } = require("chai");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const TenantManager = require("../src/commons/data-managers/tenant-manager");
const clientRegistry = require("../src/commons/services/access/clients/access-client-registry");
const {
  forgetSaltoKsClients,
} = require("../src/commons/services/access/clients/salto-ks-clients");
const SaltoKsIqActivationService = require("../src/commons/services/access/salto-ks-iq-activation-service");
const SaltoKsAccessProvider = require("../src/commons/services/access/providers/salto-ks-access-provider");
const {
  fakeSaltoKsConnectApi,
  FAKE_SITE,
  FAKE_SITE_ID,
} = require("./helpers/fake-salto-ks-api-client");
const { saltoLock, saltoIq } = require("./helpers/access-provider-fixtures");

const TENANT_ID = "tenant-1";
const OTHER_TENANT_ID = "tenant-2";

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

describe("Salto KS token reuse", () => {
  let api;
  let apps;

  beforeEach(() => {
    forgetSaltoKsClients();
    api = fakeSaltoKsConnectApi({ locks: [saltoLock()], iqs: [saltoIq()] });
    apps = { [TENANT_ID]: saltoApp(), [OTHER_TENANT_ID]: saltoApp() };
    sinon.stub(TenantManager, "getTenant").callsFake(async (id) => ({
      id,
      applications: [{ ...apps[id] }],
    }));
    sinon.stub(clientRegistry, "createClient").callsFake(api.clientFor);
  });

  afterEach(() => {
    sinon.restore();
    forgetSaltoKsClients();
  });

  it("signs in once for two calls with the same credentials", async () => {
    await SaltoKsIqActivationService.listIqs(TENANT_ID);
    await SaltoKsIqActivationService.listIqs(TENANT_ID);

    expect(api.tokenRequests).to.have.length(1);
  });

  for (const [field, value] of [
    ["clientId", "rotated-client-id"],
    ["clientSecret", "rotated-client-secret"],
    ["username", "other-system-user@example.test"],
    ["password", "rotated-password"],
    ["environment", "production"],
  ]) {
    it(`signs in anew with the new ${field} once it changed`, async () => {
      await SaltoKsIqActivationService.listIqs(TENANT_ID);
      apps[TENANT_ID][field] = value;
      await SaltoKsIqActivationService.listIqs(TENANT_ID);
      await SaltoKsIqActivationService.listIqs(TENANT_ID);

      expect(api.tokenRequests).to.have.length(2);
      expect(api.tokenRequests[1][field]).to.equal(value);
    });
  }

  it("signs in anew once the site changed", async () => {
    await SaltoKsIqActivationService.listIqs(TENANT_ID);
    apps[TENANT_ID].siteId = FAKE_SITE.customer_reference;
    await SaltoKsIqActivationService.listIqs(TENANT_ID);

    expect(api.tokenRequests).to.have.length(2);
  });

  it("shares the sign-in between the access provider and the activation service", async () => {
    const provider = new SaltoKsAccessProvider();

    await provider.listAccessPoints(TENANT_ID);
    await SaltoKsIqActivationService.listIqs(TENANT_ID);
    await provider.listAccessPoints(TENANT_ID);

    expect(api.tokenRequests).to.have.length(1);
  });

  it("signs in once for calls that start together", async () => {
    await Promise.all([
      SaltoKsIqActivationService.listIqs(TENANT_ID),
      SaltoKsIqActivationService.listIqs(TENANT_ID),
      new SaltoKsAccessProvider().listAccessPoints(TENANT_ID),
    ]);

    expect(api.tokenRequests).to.have.length(1);
  });

  it("signs in again once the token's lifetime is over", async () => {
    const clock = sinon.useFakeTimers({
      now: Date.UTC(2026, 9, 15, 8, 0, 0),
      toFake: ["Date"],
    });

    await SaltoKsIqActivationService.listIqs(TENANT_ID);
    clock.tick(30 * 60 * 1000);
    await SaltoKsIqActivationService.listIqs(TENANT_ID);
    expect(api.tokenRequests).to.have.length(1);

    clock.tick(30 * 60 * 1000);
    await SaltoKsIqActivationService.listIqs(TENANT_ID);
    expect(api.tokenRequests).to.have.length(2);
  });

  it("signs in again after Salto refused the token with 401", async () => {
    await SaltoKsIqActivationService.listIqs(TENANT_ID);
    api.clients[0].revokedTokens.add("fake-token-1");

    let refusal;
    try {
      await SaltoKsIqActivationService.listIqs(TENANT_ID);
    } catch (err) {
      refusal = err;
    }
    expect(refusal?.response?.status).to.equal(401);

    const iqs = await SaltoKsIqActivationService.listIqs(TENANT_ID);
    expect(iqs).to.have.length(1);
    expect(api.tokenRequests).to.have.length(2);
  });

  it("keeps one sign-in per tenant", async () => {
    await SaltoKsIqActivationService.listIqs(TENANT_ID);
    await SaltoKsIqActivationService.listIqs(OTHER_TENANT_ID);
    await SaltoKsIqActivationService.listIqs(TENANT_ID);
    await SaltoKsIqActivationService.listIqs(OTHER_TENANT_ID);

    expect(api.tokenRequests).to.have.length(2);
  });
});
