const { expect } = require("chai");
const sinon = require("sinon");

const NukiAccessProvider = require("../src/commons/services/access/providers/nuki-access-provider");
const {
  NUKI_ACTIONS,
  NUKI_DEVICE_TYPES,
} = require("../src/commons/services/access/clients/nuki-api-client");
const { LockBusyError } = require("../src/errors/LockBusyError");
const { AccessOpenError } = require("../src/errors/AccessOpenError");

/** What axios throws when Nuki answers with the given status. */
function nukiError(status, message = `Request failed with status ${status}`) {
  const err = new Error(message);
  err.response = { status, data: {} };
  return err;
}

describe("LockBusyError", () => {
  it("is the 423 of the access API, named after the provider and the action", () => {
    const err = new LockBusyError("nuki", "open");

    expect(err).to.be.instanceOf(Error);
    expect(err.toJSON()).to.deep.equal({
      error: "LockBusyError",
      code: "lock_busy",
      statusCode: 423,
      params: { provider: "nuki", action: "open" },
    });
  });
});

describe("Nuki provider on a smartlock busy with its previous action", () => {
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
        .resolves({ smartlockId: 1, type: NUKI_DEVICE_TYPES.SMART_LOCK_3_4 }),
      executeAction: sandbox.stub().rejects(nukiError(423)),
    };
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
    throw new Error("expected the action to be refused");
  }

  for (const [action, run] of [
    ["open", () => provider.open(accessPoint, bookingContext)],
    ["unlatch", () => provider.unlatch(accessPoint, bookingContext)],
    ["close", () => provider.close(accessPoint, bookingContext)],
  ]) {
    it(`answers a Nuki 423 on ${action} with Lock Busy`, async () => {
      const err = await rejectionOf(run());

      expect(err).to.be.instanceOf(LockBusyError);
      expect(err.code).to.equal("lock_busy");
      expect(err.statusCode).to.equal(423);
      expect(err.params).to.deep.equal({ provider: "nuki", action });
      expect(err.message).to.equal(
        "Nuki reports smartlock 'lock-1' busy with its previous action",
      );
    });
  }

  it("still tells an open failure by its class when the lock is not busy", async () => {
    client.executeAction.rejects(nukiError(502, "bad gateway"));

    const err = await rejectionOf(provider.open(accessPoint, bookingContext));

    expect(err).to.be.instanceOf(AccessOpenError);
    expect(err.failureClass).to.equal("temporary");
  });

  it("still rethrows any other close failure as Nuki reported it", async () => {
    const raw = nukiError(502, "bad gateway");
    client.executeAction.rejects(raw);

    const err = await rejectionOf(provider.close(accessPoint, bookingContext));

    expect(err).to.equal(raw);
    expect(
      client.executeAction.calledOnceWithExactly("lock-1", NUKI_ACTIONS.LOCK),
    ).to.be.true;
  });
});
