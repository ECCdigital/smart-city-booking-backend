const { expect } = require("chai");
const sinon = require("sinon");

const NukiAccessProvider = require("../src/commons/services/access/providers/nuki-access-provider");
const {
  NukiApiClient,
  NUKI_ACTIONS,
  NUKI_DEVICE_TYPES,
} = require("../src/commons/services/access/clients/nuki-api-client");

describe("Nuki open pulls the latch where the lock has one", () => {
  let sandbox;
  let provider;
  let client;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    provider = new NukiAccessProvider();
    client = {
      getSmartlock: sandbox.stub(),
      executeAction: sandbox.stub().resolves({ id: "action-1" }),
    };
    sandbox.stub(provider, "_getClient").resolves(client);
  });

  afterEach(() => {
    sandbox.restore();
  });

  function open(smartlock) {
    client.getSmartlock.resolves(smartlock);

    return provider.open(
      { id: "point-1", externalId: "lock-1" },
      { tenant: "tenant-1" },
    );
  }

  it("unlatches a smart lock, so the door actually opens", async () => {
    await open({ smartlockId: 1, type: NUKI_DEVICE_TYPES.SMART_LOCK_3_4 });

    expect(
      client.executeAction.calledOnceWithExactly(
        "lock-1",
        NUKI_ACTIONS.UNLATCH,
      ),
    ).to.be.true;
  });

  it("unlocks an opener, which has no latch to pull", async () => {
    await open({ smartlockId: 1, type: NUKI_DEVICE_TYPES.OPENER });

    expect(
      client.executeAction.calledOnceWithExactly("lock-1", NUKI_ACTIONS.UNLOCK),
    ).to.be.true;
  });

  it("unlocks a box, which has no door at all", async () => {
    await open({ smartlockId: 1, type: NUKI_DEVICE_TYPES.BOX });

    expect(
      client.executeAction.calledOnceWithExactly("lock-1", NUKI_ACTIONS.UNLOCK),
    ).to.be.true;
  });

  it("unlocks a lock that does not say what it is", async () => {
    await open({ smartlockId: 1 });

    expect(
      client.executeAction.calledOnceWithExactly("lock-1", NUKI_ACTIONS.UNLOCK),
    ).to.be.true;
  });

  it("unlocks when the lock cannot be read, rather than leaving the door shut", async () => {
    client.getSmartlock.rejects(new Error("Nuki API unreachable"));

    const result = await provider.open(
      { id: "point-1", externalId: "lock-1" },
      { tenant: "tenant-1" },
    );

    expect(
      client.executeAction.calledOnceWithExactly("lock-1", NUKI_ACTIONS.UNLOCK),
    ).to.be.true;
    expect(result.success).to.be.true;
  });

  it("sends one action and never a second one after it", async () => {
    await open({ smartlockId: 1, type: NUKI_DEVICE_TYPES.SMART_DOOR });

    expect(client.executeAction.callCount).to.equal(1);
  });

  describe("NukiApiClient.canUnlatchSmartlock", () => {
    it("knows the device types that sit on a door with a latch", () => {
      const latchTypes = [
        NUKI_DEVICE_TYPES.SMART_LOCK_1_2,
        NUKI_DEVICE_TYPES.SMART_DOOR,
        NUKI_DEVICE_TYPES.SMART_LOCK_3_4,
        NUKI_DEVICE_TYPES.SMART_LOCK_ULTRA,
      ];

      for (const type of latchTypes) {
        expect(NukiApiClient.canUnlatchSmartlock({ type })).to.be.true;
      }
    });

    it("reads the device type out of the config when the smartlock names it there", () => {
      expect(
        NukiApiClient.canUnlatchSmartlock({
          config: { deviceType: NUKI_DEVICE_TYPES.SMART_LOCK_ULTRA },
        }),
      ).to.be.true;
    });

    it("says no for an opener, a box and a lock it knows nothing about", () => {
      expect(
        NukiApiClient.canUnlatchSmartlock({ type: NUKI_DEVICE_TYPES.OPENER }),
      ).to.be.false;
      expect(NukiApiClient.canUnlatchSmartlock({ type: NUKI_DEVICE_TYPES.BOX }))
        .to.be.false;
      expect(NukiApiClient.canUnlatchSmartlock({})).to.be.false;
      expect(NukiApiClient.canUnlatchSmartlock(null)).to.be.false;
    });
  });
});
