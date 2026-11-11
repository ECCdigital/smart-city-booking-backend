const assert = require("assert");
const sinon = require("sinon");

const LockerSystemMutex = require("../src/commons/services/access/locker-system-mutex");
const LockerSystemHoldManager = require("../src/commons/data-managers/locker-system-hold-manager");

const {
  installInMemoryLockerSystemHolds,
} = require("./helpers/in-memory-locker-system-holds");

const LOCKER_SYSTEM = { tenantId: "tenant-1", id: "locker-system-1" };

/** A promise with its `resolve` at hand: work that ends when the test says. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("LockerSystemMutex.hold", function () {
  let clock;

  beforeEach(function () {
    clock = sinon.useFakeTimers({ now: new Date("2026-11-11T10:00:00Z") });
    installInMemoryLockerSystemHolds();
  });

  afterEach(function () {
    sinon.restore();
  });

  it("runs the work while holding the locker system and answers its result", async function () {
    const result = await LockerSystemMutex.hold(
      LOCKER_SYSTEM,
      async () => "compartment-1",
    );

    assert.strictEqual(result, "compartment-1");
  });

  it("lets a second hold of the same locker system wait until the first is done", async function () {
    const first = deferred();
    const order = [];

    const firstHold = LockerSystemMutex.hold(LOCKER_SYSTEM, async () => {
      order.push("first started");
      await first.promise;
      order.push("first done");
    });
    await clock.tickAsync(10);
    const secondHold = LockerSystemMutex.hold(LOCKER_SYSTEM, async () => {
      order.push("second started");
    });
    await clock.tickAsync(1000);

    assert.deepStrictEqual(order, ["first started"]);

    first.resolve();
    await clock.tickAsync(1000);
    await Promise.all([firstHold, secondHold]);

    assert.deepStrictEqual(order, [
      "first started",
      "first done",
      "second started",
    ]);
  });

  it("does not let a hold of another locker system wait", async function () {
    const first = deferred();
    const order = [];

    const firstHold = LockerSystemMutex.hold(LOCKER_SYSTEM, async () => {
      order.push("first started");
      await first.promise;
    });
    await clock.tickAsync(10);
    await LockerSystemMutex.hold(
      { tenantId: "tenant-1", id: "locker-system-2" },
      async () => {
        order.push("other started");
      },
    );

    assert.deepStrictEqual(order, ["first started", "other started"]);

    first.resolve();
    await firstHold;
  });

  it("lets a hold that is never released expire, so the next one gets in", async function () {
    const order = [];

    // Work that never ends stands for a process that died holding.
    LockerSystemMutex.hold(
      LOCKER_SYSTEM,
      async () => {
        order.push("crashed started");
        await new Promise(() => {});
      },
      { ttlMs: 5000 },
    );
    await clock.tickAsync(10);
    const nextHold = LockerSystemMutex.hold(LOCKER_SYSTEM, async () => {
      order.push("next started");
    });

    await clock.tickAsync(4000);
    assert.deepStrictEqual(order, ["crashed started"]);

    await clock.tickAsync(2000);
    await nextHold;
    assert.deepStrictEqual(order, ["crashed started", "next started"]);
  });

  it("gives the hold back when the work fails, and answers the failure", async function () {
    await assert.rejects(
      LockerSystemMutex.hold(LOCKER_SYSTEM, async () => {
        throw new Error("compartments_unavailable");
      }),
      { message: "compartments_unavailable" },
    );

    const result = await LockerSystemMutex.hold(
      LOCKER_SYSTEM,
      async () => "next",
    );
    assert.strictEqual(result, "next");
  });

  it("does not let a hold that outlived its expiry free the hold of the next", async function () {
    const slow = deferred();
    const next = deferred();
    const order = [];

    const slowHold = LockerSystemMutex.hold(
      LOCKER_SYSTEM,
      async () => {
        await slow.promise;
      },
      { ttlMs: 5000 },
    );
    await clock.tickAsync(10);
    const nextHold = LockerSystemMutex.hold(LOCKER_SYSTEM, async () => {
      order.push("next started");
      await next.promise;
    });
    await clock.tickAsync(6000);
    assert.deepStrictEqual(order, ["next started"]);

    slow.resolve();
    await slowHold;
    const thirdHold = LockerSystemMutex.hold(LOCKER_SYSTEM, async () => {
      order.push("third started");
    });
    await clock.tickAsync(1000);
    assert.deepStrictEqual(order, ["next started"]);

    next.resolve();
    await clock.tickAsync(1000);
    await Promise.all([nextHold, thirdHold]);
    assert.deepStrictEqual(order, ["next started", "third started"]);
  });

  it("gives up waiting after the wait limit, without running the work", async function () {
    const first = deferred();
    let secondRan = false;

    const firstHold = LockerSystemMutex.hold(LOCKER_SYSTEM, async () => {
      await first.promise;
    });
    await clock.tickAsync(10);
    const secondHold = LockerSystemMutex.hold(
      LOCKER_SYSTEM,
      async () => {
        secondRan = true;
      },
      { waitMs: 3000 },
    );
    const outcome = assert.rejects(secondHold, {
      code: "locker_system_busy",
      statusCode: 503,
    });
    await clock.tickAsync(3100);
    await outcome;
    assert.strictEqual(secondRan, false);

    first.resolve();
    await firstHold;
  });

  it("answers the work's result even when giving the hold back fails", async function () {
    LockerSystemHoldManager.release.rejects(new Error("connection reset"));

    const result = await LockerSystemMutex.hold(
      LOCKER_SYSTEM,
      async () => "compartment-1",
    );

    assert.strictEqual(result, "compartment-1");
  });
});
