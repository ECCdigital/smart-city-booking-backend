const { expect } = require("chai");
const sinon = require("sinon");

const AccessLocationService = require("../src/commons/services/access/access-location-service");
const AccessInfoService = require("../src/commons/services/access/access-info-service");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const NukiAccessProvider = require("../src/commons/services/access/providers/nuki-access-provider");
const SaltoKsAccessProvider = require("../src/commons/services/access/providers/salto-ks-access-provider");
const {
  getAccessProvider,
  getAccessProviderCapabilities,
} = require("../src/commons/services/access/providers/access-provider-registry");

require("../src/commons/services/access/providers/register-access-providers");

function createAccessPoint(overrides = {}) {
  return {
    id: "point-1",
    tenantId: "tenant-1",
    provider: "nuki",
    externalId: "lock-1",
    ...overrides,
  };
}

describe("Access point location prefill", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("NukiAccessProvider.getLocation", () => {
    let provider;
    let client;

    beforeEach(() => {
      provider = new NukiAccessProvider();
      client = { getSmartlock: sandbox.stub() };
      sandbox.stub(provider, "_getClient").resolves(client);
    });

    it("declares getLocation as a capability", () => {
      expect(NukiAccessProvider.capabilities).to.include("getLocation");
    });

    it("maps the smartlock coordinates to a point in lng, lat order", async () => {
      client.getSmartlock.resolves({
        smartlockId: 1,
        config: { latitude: 51.2, longitude: 7.1 },
      });

      const location = await provider.getLocation(
        createAccessPoint(),
        "tenant-1",
      );

      expect(client.getSmartlock.calledOnceWithExactly("lock-1")).to.be.true;
      expect(location).to.deep.equal({
        coordinates: { type: "Point", points: [7.1, 51.2] },
      });
    });

    it("reports no address, NUKI does not know one", async () => {
      client.getSmartlock.resolves({
        config: { latitude: 51.2, longitude: 7.1 },
      });

      const location = await provider.getLocation(
        createAccessPoint(),
        "tenant-1",
      );

      expect(location).to.not.have.property("address");
      expect(location).to.not.have.property("display_address");
    });

    it("returns null when the smartlock has no coordinates", async () => {
      client.getSmartlock.resolves({ smartlockId: 1, config: {} });

      const location = await provider.getLocation(
        createAccessPoint(),
        "tenant-1",
      );

      expect(location).to.be.null;
    });

    it("returns null for a smartlock without a config", async () => {
      client.getSmartlock.resolves({ smartlockId: 1 });

      const location = await provider.getLocation(
        createAccessPoint(),
        "tenant-1",
      );

      expect(location).to.be.null;
    });

    it("returns null for the null island, which means the lock is unpositioned", async () => {
      client.getSmartlock.resolves({ config: { latitude: 0, longitude: 0 } });

      const location = await provider.getLocation(
        createAccessPoint(),
        "tenant-1",
      );

      expect(location).to.be.null;
    });

    it("returns null for coordinates outside the valid range", async () => {
      client.getSmartlock.resolves({
        config: { latitude: 91, longitude: 7.1 },
      });

      const location = await provider.getLocation(
        createAccessPoint(),
        "tenant-1",
      );

      expect(location).to.be.null;
    });

    it("returns null for coordinates that are not numbers", async () => {
      client.getSmartlock.resolves({
        config: { latitude: "51.2", longitude: null },
      });

      const location = await provider.getLocation(
        createAccessPoint(),
        "tenant-1",
      );

      expect(location).to.be.null;
    });
  });

  describe("Salto KS", () => {
    it("does not declare getLocation, the Connect API carries no geo data", () => {
      expect(SaltoKsAccessProvider.capabilities).to.not.include("getLocation");
    });

    it("answers a prefill with null, without asking the Salto API", async () => {
      const provider = getAccessProvider("salto-ks");
      const getClient = sandbox.stub(provider, "_getClient");

      const location = await AccessLocationService.getLocationPrefill(
        createAccessPoint({ provider: "salto-ks", externalId: "lock-9" }),
        "tenant-1",
      );

      expect(location).to.be.null;
      expect(getClient.called).to.be.false;
    });
  });

  describe("AccessLocationService.getLocationPrefill", () => {
    it("returns what the provider of the access point reports", async () => {
      const accessPoint = createAccessPoint();
      const prefill = { coordinates: { type: "Point", points: [7.1, 51.2] } };
      const getLocation = sandbox
        .stub(getAccessProvider("nuki"), "getLocation")
        .resolves(prefill);

      const location = await AccessLocationService.getLocationPrefill(
        accessPoint,
        "tenant-1",
      );

      expect(location).to.deep.equal(prefill);
      expect(getLocation.calledOnceWithExactly(accessPoint, "tenant-1")).to.be
        .true;
    });

    it("returns null for a provider without the getLocation capability", async () => {
      const getLocation = sandbox.stub(
        getAccessProvider("ifbs"),
        "getLocation",
      );

      const location = await AccessLocationService.getLocationPrefill(
        createAccessPoint({ provider: "ifbs" }),
        "tenant-1",
      );

      expect(location).to.be.null;
      expect(getLocation.called).to.be.false;
    });

    it("returns null for a provider that is not registered", async () => {
      const location = await AccessLocationService.getLocationPrefill(
        createAccessPoint({ provider: "no-such-provider" }),
        "tenant-1",
      );

      expect(location).to.be.null;
    });

    it("returns null when the provider reports nothing", async () => {
      sandbox
        .stub(getAccessProvider("nuki"), "getLocation")
        .resolves(undefined);

      const location = await AccessLocationService.getLocationPrefill(
        createAccessPoint(),
        "tenant-1",
      );

      expect(location).to.be.null;
    });

    it("lets provider errors through, a broken provider is not an empty result", async () => {
      const failure = new Error("Nuki API Error");
      sandbox.stub(getAccessProvider("nuki"), "getLocation").rejects(failure);
      let caught = null;

      try {
        await AccessLocationService.getLocationPrefill(
          createAccessPoint(),
          "tenant-1",
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).to.equal(failure);
    });
  });

  describe("Capability declaration", () => {
    it("tells which providers support a location prefill", () => {
      expect(getAccessProviderCapabilities("nuki")).to.include("getLocation");
      expect(getAccessProviderCapabilities("salto-ks")).to.not.include(
        "getLocation",
      );
      expect(getAccessProviderCapabilities("ifbs")).to.not.include(
        "getLocation",
      );
      expect(getAccessProviderCapabilities("no-such-provider")).to.deep.equal(
        [],
      );
    });

    it("exposes the provider capabilities of the active providers", async () => {
      sandbox.stub(TenantManager, "getTenant").resolves({
        applications: [
          { type: "access", id: "nuki", title: "Nuki Türen", active: true },
          { type: "access", id: "salto-ks", active: true },
          { type: "access", id: "ifbs", active: false },
        ],
      });

      const providers = await AccessInfoService.getActiveProviders("tenant-1");

      expect(providers.map((p) => p.id)).to.deep.equal(["nuki", "salto-ks"]);
      expect(providers[0].providerCapabilities).to.include("getLocation");
      expect(providers[1].providerCapabilities).to.not.include("getLocation");
    });
  });
});
