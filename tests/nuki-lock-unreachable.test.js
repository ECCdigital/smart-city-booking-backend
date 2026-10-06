const { expect } = require("chai");
const sinon = require("sinon");

const NukiAccessProvider = require("../src/commons/services/access/providers/nuki-access-provider");
const {
  NukiApiClient,
  NUKI_DEVICE_TYPES,
  NUKI_SERVER_STATES,
} = require("../src/commons/services/access/clients/nuki-api-client");
const { LockBusyError } = require("../src/errors/LockBusyError");
const { LockUnreachableError } = require("../src/errors/LockUnreachableError");

/** What axios throws when Nuki answers with the given status. */
function nukiError(status, message = `Request failed with status ${status}`) {
  const err = new Error(message);
  err.response = { status, data: {} };
  return err;
}

/**
 * A smartlock as `GET /smartlock/{id}` answers it: Nuki keeps the last
 * state it heard from the lock and says separately, in `serverState`,
 * whether it can reach the lock right now.
 */
function smartlock({ serverState, lockState }) {
  return {
    smartlockId: 1,
    type: NUKI_DEVICE_TYPES.SMART_LOCK_3_4,
    serverState,
    state: { state: lockState },
  };
}

describe("LockUnreachableError", () => {
  it("is the 503 of the access API, named after the provider and the action", () => {
    const err = new LockUnreachableError("nuki", "status");

    expect(err).to.be.instanceOf(Error);
    expect(err.toJSON()).to.deep.equal({
      error: "LockUnreachableError",
      code: "lock_unreachable",
      statusCode: 503,
      params: { provider: "nuki", action: "status" },
    });
  });
});

describe("Nuki provider on a smartlock Nuki cannot reach", () => {
  let sandbox;
  let provider;
  let client;

  const accessPoint = { id: "point-1", externalId: "lock-1" };
  const bookingContext = { tenant: "tenant-1" };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    provider = new NukiAccessProvider();
    client = {
      getSmartlock: sandbox
        .stub()
        .resolves(
          smartlock({ serverState: NUKI_SERVER_STATES.OFFLINE, lockState: 3 }),
        ),
      executeAction: sandbox.stub().rejects(nukiError(423)),
    };
    // The real reduction of a smartlock to its state, over the stubbed read.
    client.getSmartlockState = (id) =>
      NukiApiClient.prototype.getSmartlockState.call(client, id);
    sandbox.stub(provider, "_getClient").resolves(client);
  });

  afterEach(() => {
    sandbox.restore();
  });

  async function rejectionOf(promise) {
    try {
      await promise;
    } catch (err) {
      return err;
    }
    throw new Error("expected the call to be refused");
  }

  it("does not pass the last known lock state off as the status", async () => {
    const err = await rejectionOf(
      provider.getStatus(accessPoint, bookingContext),
    );

    expect(err).to.be.instanceOf(LockUnreachableError);
    expect(err.params).to.deep.equal({ provider: "nuki", action: "status" });
    expect(err.message).to.equal(
      "Nuki cannot reach smartlock 'lock-1' (serverState offline)",
    );
  });

  it("reports the state of a lock Nuki can reach", async () => {
    client.getSmartlock.resolves(
      smartlock({ serverState: NUKI_SERVER_STATES.OK, lockState: 3 }),
    );

    const status = await provider.getStatus(accessPoint, bookingContext);

    expect(status).to.deep.equal({ open: true, locked: false, doorOpen: null });
  });

  it("reports the state of a lock whose answer names no serverState", async () => {
    client.getSmartlock.resolves({ smartlockId: 1, state: { state: 1 } });

    const status = await provider.getStatus(accessPoint, bookingContext);

    expect(status).to.deep.equal({ open: false, locked: true, doorOpen: null });
  });

  for (const [action, run] of [
    ["open", () => provider.open(accessPoint, bookingContext)],
    ["close", () => provider.close(accessPoint, bookingContext)],
  ]) {
    it(`tells a Nuki 423 on ${action} of an offline lock apart from Lock Busy`, async () => {
      const err = await rejectionOf(run());

      expect(err).to.be.instanceOf(LockUnreachableError);
      expect(err.params).to.deep.equal({ provider: "nuki", action });
    });

    it(`keeps a Nuki 423 on ${action} of a reachable lock as Lock Busy`, async () => {
      client.getSmartlock.resolves(
        smartlock({ serverState: NUKI_SERVER_STATES.OK, lockState: 3 }),
      );

      const err = await rejectionOf(run());

      expect(err).to.be.instanceOf(LockBusyError);
    });

    it(`keeps a Nuki 423 on ${action} as Lock Busy when the lock cannot be read`, async () => {
      client.getSmartlock.rejects(nukiError(500));

      const err = await rejectionOf(run());

      expect(err).to.be.instanceOf(LockBusyError);
    });
  }
});
