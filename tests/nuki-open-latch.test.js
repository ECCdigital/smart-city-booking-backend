const { expect } = require("chai");
const sinon = require("sinon");

const NukiAccessProvider = require("../src/commons/services/access/providers/nuki-access-provider");
const {
  NukiApiClient,
  NUKI_ACTIONS,
  NUKI_DEVICE_TYPES,
  NUKI_OPEN_ACTIONS,
  NUKI_OPEN_ACTION_NUMBERS,
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
    expect(result).to.deep.equal({ state: "opened", openProcessId: null });
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

  describe("the Öffnungsart vocabulary the client exports", () => {
    it("names the five open actions and maps the explicit ones to Nuki's action numbers", () => {
      expect(NUKI_OPEN_ACTIONS).to.deep.equal({
        AUTO: "auto",
        UNLOCK: "unlock",
        UNLATCH: "unlatch",
        LOCK_N_GO: "lock_n_go",
        LOCK_N_GO_UNLATCH: "lock_n_go_unlatch",
      });
      expect(NUKI_OPEN_ACTION_NUMBERS).to.deep.equal({
        unlock: 1,
        unlatch: 3,
        lock_n_go: 4,
        lock_n_go_unlatch: 5,
      });
      expect(NUKI_ACTIONS.LOCK_N_GO_UNLATCH).to.equal(5);
    });
  });

  describe("NukiApiClient.supportedOpenActionsForSmartlock", () => {
    const ALL_FIVE = [
      "auto",
      "unlock",
      "unlatch",
      "lock_n_go",
      "lock_n_go_unlatch",
    ];

    it("lets a Smart Lock 1/2, a Smart Door, a Smart Lock 3/4 and a Gen 5 do all five", () => {
      for (const type of [
        NUKI_DEVICE_TYPES.SMART_LOCK_1_2,
        NUKI_DEVICE_TYPES.SMART_DOOR,
        NUKI_DEVICE_TYPES.SMART_LOCK_3_4,
        NUKI_DEVICE_TYPES.SMART_LOCK_ULTRA,
      ]) {
        expect(
          NukiApiClient.supportedOpenActionsForSmartlock({ type }),
          `type ${type}`,
        ).to.deep.equal(ALL_FIVE);
      }
    });

    it("lets a Box only unlock: it has no door and no latch", () => {
      expect(
        NukiApiClient.supportedOpenActionsForSmartlock({
          type: NUKI_DEVICE_TYPES.BOX,
        }),
      ).to.deep.equal(["auto", "unlock"]);
    });

    it("lets an Opener do nothing but auto: it buzzes the door, it does not unlock or unlatch", () => {
      expect(
        NukiApiClient.supportedOpenActionsForSmartlock({
          type: NUKI_DEVICE_TYPES.OPENER,
        }),
      ).to.deep.equal(["auto"]);
    });

    it("reads the device type out of the config when the smartlock names it there", () => {
      expect(
        NukiApiClient.supportedOpenActionsForSmartlock({
          config: { deviceType: NUKI_DEVICE_TYPES.OPENER },
        }),
      ).to.deep.equal(["auto"]);
    });

    it("answers all five for an unknown or missing device type: an unknown capability is not a missing one", () => {
      expect(
        NukiApiClient.supportedOpenActionsForSmartlock({ type: 42 }),
      ).to.deep.equal(ALL_FIVE);
      expect(NukiApiClient.supportedOpenActionsForSmartlock({})).to.deep.equal(
        ALL_FIVE,
      );
      expect(
        NukiApiClient.supportedOpenActionsForSmartlock(null),
      ).to.deep.equal(ALL_FIVE);
    });
  });
});
