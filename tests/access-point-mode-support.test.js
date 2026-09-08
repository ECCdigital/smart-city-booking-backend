const { expect } = require("chai");
const sinon = require("sinon");

const AccessInfoService = require("../src/commons/services/access/access-info-service");
const AccessProvider = require("../src/commons/services/access/providers/access-provider");
const {
  getAccessProvider,
  registerAccessProvider,
} = require("../src/commons/services/access/providers/access-provider-registry");

require("../src/commons/services/access/providers/register-access-providers");

// A provider that opens but does not list its access points - registered
// for this suite only, since every production provider lists by now.
const BLIND_PROVIDER = "blind";
registerAccessProvider(
  BLIND_PROVIDER,
  class BlindAccessProvider extends AccessProvider {
    static get capabilities() {
      return ["open"];
    }
  },
);

function createAccessPoint(overrides = {}) {
  return {
    id: "point-1",
    tenantId: "tenant-1",
    provider: "nuki",
    externalId: "lock-1",
    mode: "authorization",
    ...overrides,
  };
}

function createProviderAccessPoint(overrides = {}) {
  return {
    id: "lock-1",
    provider: "nuki",
    externalId: "lock-1",
    supportedModes: ["authorization"],
    ...overrides,
  };
}

describe("AccessInfoService.getSupportedModes", () => {
  let sandbox;
  let listAccessPoints;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    listAccessPoints = sandbox.stub(
      getAccessProvider("nuki"),
      "listAccessPoints",
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("reports the modes the provider lists for the access point", async () => {
    listAccessPoints.resolves([
      createProviderAccessPoint({
        id: "other-point",
        externalId: "other-point",
      }),
      createProviderAccessPoint({
        supportedModes: ["remote", "authorization"],
      }),
    ]);

    const modes = await AccessInfoService.getSupportedModes(
      createAccessPoint(),
      "tenant-1",
    );

    expect(modes).to.deep.equal(["remote", "authorization"]);
    expect(listAccessPoints.calledOnceWithExactly("tenant-1")).to.be.true;
  });

  it("matches an access point the provider names by id only", async () => {
    listAccessPoints.resolves([
      createProviderAccessPoint({ id: "lock-1", externalId: undefined }),
    ]);

    const modes = await AccessInfoService.getSupportedModes(
      createAccessPoint(),
      "tenant-1",
    );

    expect(modes).to.deep.equal(["authorization"]);
  });

  it("matches an access point the provider names by externalId only", async () => {
    listAccessPoints.resolves([
      createProviderAccessPoint({ id: "internal-7", externalId: "lock-1" }),
    ]);

    const modes = await AccessInfoService.getSupportedModes(
      createAccessPoint(),
      "tenant-1",
    );

    expect(modes).to.deep.equal(["authorization"]);
  });

  it("matches ids the provider reports as numbers", async () => {
    listAccessPoints.resolves([
      createProviderAccessPoint({ id: 42, externalId: 42 }),
    ]);

    const modes = await AccessInfoService.getSupportedModes(
      createAccessPoint({ externalId: "42" }),
      "tenant-1",
    );

    expect(modes).to.deep.equal(["authorization"]);
  });

  it("reports null for an access point the provider does not list", async () => {
    listAccessPoints.resolves([
      createProviderAccessPoint({
        id: "other-point",
        externalId: "other-point",
      }),
    ]);

    const modes = await AccessInfoService.getSupportedModes(
      createAccessPoint(),
      "tenant-1",
    );

    expect(modes).to.be.null;
  });

  it("reports null for an entry listed without supportedModes", async () => {
    listAccessPoints.resolves([
      createProviderAccessPoint({ supportedModes: undefined }),
    ]);

    const modes = await AccessInfoService.getSupportedModes(
      createAccessPoint(),
      "tenant-1",
    );

    expect(modes).to.be.null;
  });

  it("reports null for an access point without an externalId", async () => {
    const modes = await AccessInfoService.getSupportedModes(
      createAccessPoint({ externalId: "" }),
      "tenant-1",
    );

    expect(modes).to.be.null;
    expect(listAccessPoints.called).to.be.false;
  });

  it("reports null for a provider that cannot list its access points", async () => {
    const modes = await AccessInfoService.getSupportedModes(
      createAccessPoint({ provider: BLIND_PROVIDER }),
      "tenant-1",
    );

    expect(modes).to.be.null;
  });

  it("reports null for a provider that is not registered", async () => {
    const modes = await AccessInfoService.getSupportedModes(
      createAccessPoint({ provider: "no-such-provider" }),
      "tenant-1",
    );

    expect(modes).to.be.null;
  });

  it("lets provider errors through, a broken provider is not an unlisted access point", async () => {
    const failure = new Error("Nuki API Error");
    listAccessPoints.rejects(failure);
    let caught = null;

    try {
      await AccessInfoService.getSupportedModes(
        createAccessPoint(),
        "tenant-1",
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).to.equal(failure);
  });
});
