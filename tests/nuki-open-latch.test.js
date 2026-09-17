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
const { AccessOpenError } = require("../src/errors/AccessOpenError");

describe("Nuki open carries out the Öffnungsart of the access point", () => {
  let sandbox;
  let provider;
  let client;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    provider = new NukiAccessProvider();
    client = {
      getSmartlock: sandbox.stub().resolves({ smartlockId: 1 }),
      executeAction: sandbox.stub().resolves({ id: "action-1" }),
    };
    sandbox.stub(provider, "_getClient").resolves(client);
  });

  afterEach(() => {
    sandbox.restore();
  });

  /** Opens an access point with the given `config`, at a lock of the given type. */
  function open({ config, type } = {}) {
    client.getSmartlock.resolves({ smartlockId: 1, type });

    return provider.open(
      { id: "point-1", externalId: "lock-1", config },
      { tenant: "tenant-1" },
    );
  }

  async function rejectionOf(promise) {
    try {
      await promise;
    } catch (err) {
      return err;
    }
    throw new Error("expected the open to be refused");
  }

  describe("an Öffnungsart the access point names itself", () => {
    const explicit = [
      [NUKI_OPEN_ACTIONS.UNLOCK, 1],
      [NUKI_OPEN_ACTIONS.UNLATCH, 3],
      [NUKI_OPEN_ACTIONS.LOCK_N_GO, 4],
      [NUKI_OPEN_ACTIONS.LOCK_N_GO_UNLATCH, 5],
    ];

    for (const [openAction, nukiAction] of explicit) {
      it(`sends Nuki action ${nukiAction} for '${openAction}'`, async () => {
        const outcome = await open({ config: { openAction } });

        expect(client.executeAction.calledOnceWithExactly("lock-1", nukiAction))
          .to.be.true;
        expect(outcome).to.deep.equal({
          state: "opened",
          openProcessId: null,
          openAction,
          openActionOrigin: "configured",
          nukiAction,
        });
      });
    }

    it("never asks the lock what it is: the setting decides, one request less", async () => {
      await open({
        config: { openAction: NUKI_OPEN_ACTIONS.LOCK_N_GO },
        type: NUKI_DEVICE_TYPES.BOX,
      });

      expect(client.getSmartlock.called).to.be.false;
    });

    it("refuses a word off the prototype chain as readily as any other stranger", async () => {
      // `NUKI_OPEN_ACTION_NUMBERS.constructor` is a function, not an action:
      // a lookup that does not ask for an own key would send it to the lock.
      for (const stranger of ["constructor", "toString", "hasOwnProperty"]) {
        const err = await rejectionOf(
          open({ config: { openAction: stranger } }),
        );

        expect(err, stranger).to.be.instanceOf(AccessOpenError);
        expect(err.failureClass, stranger).to.equal("configuration");
      }

      expect(client.executeAction.called).to.be.false;
    });

    it("refuses an Öffnungsart outside the vocabulary instead of quietly deciding for itself", async () => {
      const err = await rejectionOf(
        open({ config: { openAction: "kick_it" } }),
      );

      expect(err).to.be.instanceOf(AccessOpenError);
      expect(err.failureClass).to.equal("configuration");
      expect(err.message).to.contain("kick_it");
      expect(client.executeAction.called).to.be.false;
      expect(client.getSmartlock.called).to.be.false;
    });
  });

  describe("no Öffnungsart at the access point: the device type decides", () => {
    const autoConfigs = [
      ["no config at all", undefined],
      ["a config without the key", {}],
      ["an explicit auto", { openAction: NUKI_OPEN_ACTIONS.AUTO }],
    ];

    for (const [label, config] of autoConfigs) {
      it(`asks the lock what it is with ${label}`, async () => {
        const outcome = await open({
          config,
          type: NUKI_DEVICE_TYPES.SMART_LOCK_3_4,
        });

        expect(client.getSmartlock.calledOnceWithExactly("lock-1")).to.be.true;
        expect(outcome).to.deep.equal({
          state: "opened",
          openProcessId: null,
          openAction: NUKI_OPEN_ACTIONS.UNLATCH,
          openActionOrigin: "device_type",
          nukiAction: NUKI_ACTIONS.UNLATCH,
        });
      });
    }

    const byDeviceType = [
      ["a Smart Lock 1/2", NUKI_DEVICE_TYPES.SMART_LOCK_1_2, "unlatch", 3],
      ["a Box, which has no door to open", NUKI_DEVICE_TYPES.BOX, "unlock", 1],
      [
        "an Opener, whose action 3 opens the door where action 1 only arms Ring-to-Open",
        NUKI_DEVICE_TYPES.OPENER,
        "unlatch",
        3,
      ],
      ["a Smart Door", NUKI_DEVICE_TYPES.SMART_DOOR, "unlatch", 3],
      ["a Smart Lock 3/4", NUKI_DEVICE_TYPES.SMART_LOCK_3_4, "unlatch", 3],
      ["a Gen 5", NUKI_DEVICE_TYPES.SMART_LOCK_ULTRA, "unlatch", 3],
    ];

    for (const [label, type, openAction, nukiAction] of byDeviceType) {
      it(`opens ${label} with '${openAction}'`, async () => {
        const outcome = await open({ type });

        expect(client.executeAction.calledOnceWithExactly("lock-1", nukiAction))
          .to.be.true;
        expect(outcome.openAction).to.equal(openAction);
        expect(outcome.openActionOrigin).to.equal("device_type");
      });
    }

    it("unlocks a lock that does not say what it is, and says the choice was a fallback", async () => {
      const outcome = await open({ type: undefined });

      expect(
        client.executeAction.calledOnceWithExactly(
          "lock-1",
          NUKI_ACTIONS.UNLOCK,
        ),
      ).to.be.true;
      expect(outcome).to.deep.equal({
        state: "opened",
        openProcessId: null,
        openAction: NUKI_OPEN_ACTIONS.UNLOCK,
        openActionOrigin: "fallback",
        nukiAction: NUKI_ACTIONS.UNLOCK,
      });
    });

    it("unlocks when the lock cannot be read, rather than leaving the door shut", async () => {
      client.getSmartlock.rejects(new Error("Nuki API unreachable"));

      const outcome = await provider.open(
        { id: "point-1", externalId: "lock-1" },
        { tenant: "tenant-1" },
      );

      expect(
        client.executeAction.calledOnceWithExactly(
          "lock-1",
          NUKI_ACTIONS.UNLOCK,
        ),
      ).to.be.true;
      expect(outcome.openActionOrigin).to.equal("fallback");
    });

    it("sends one action and never a second one after it", async () => {
      await open({ type: NUKI_DEVICE_TYPES.SMART_DOOR });

      expect(client.executeAction.callCount).to.equal(1);
    });
  });

  describe("a failed open says which Öffnungsart it was", () => {
    /** What axios throws when Nuki answers with the given status. */
    function nukiError(status) {
      return Object.assign(new Error(`Request failed with status ${status}`), {
        response: { status, data: {} },
      });
    }

    it("turns a Nuki 400 into a configuration failure and does not try unlock afterwards", async () => {
      client.executeAction.rejects(nukiError(400));

      const err = await rejectionOf(
        open({ config: { openAction: NUKI_OPEN_ACTIONS.LOCK_N_GO_UNLATCH } }),
      );

      expect(err).to.be.instanceOf(AccessOpenError);
      expect(err.failureClass).to.equal("configuration");
      expect(client.executeAction.callCount).to.equal(1);
      expect(err.openAction).to.equal(NUKI_OPEN_ACTIONS.LOCK_N_GO_UNLATCH);
      expect(err.openActionOrigin).to.equal("configured");
      expect(err.nukiAction).to.equal(5);
    });

    it("names the Öffnungsart on a busy lock too, so the audit records what went out", async () => {
      client.executeAction.rejects(nukiError(423));

      const err = await rejectionOf(open({ type: NUKI_DEVICE_TYPES.OPENER }));

      expect(err.code).to.equal("lock_busy");
      expect(err.openAction).to.equal(NUKI_OPEN_ACTIONS.UNLATCH);
      expect(err.openActionOrigin).to.equal("device_type");
      expect(err.nukiAction).to.equal(NUKI_ACTIONS.UNLATCH);
    });

    it("says nothing about an Öffnungsart when the open failed before there was one", async () => {
      provider._getClient.rejects(new Error("tenant unreadable"));

      const err = await rejectionOf(open({}));

      expect(err).to.be.instanceOf(AccessOpenError);
      expect(err).to.not.have.property("openAction");
      expect(err).to.not.have.property("openActionOrigin");
      expect(err).to.not.have.property("nukiAction");
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
