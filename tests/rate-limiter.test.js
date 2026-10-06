const assert = require("assert");
const sinon = require("sinon");

const RateLimiter = require("../src/commons/services/rate-limit/rate-limiter");

const {
  installInMemoryRateLimitEvents: installInMemoryEvents,
} = require("./helpers/in-memory-rate-limit-events");

const T0 = new Date("2026-09-21T10:00:00.000Z");
const at = (seconds) => new Date(T0.getTime() + seconds * 1000);

describe("RateLimiter.consume", function () {
  let events;

  beforeEach(function () {
    events = installInMemoryEvents();
  });

  afterEach(function () {
    sinon.restore();
  });

  it("allows up to the limit within the window", async function () {
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(
        await RateLimiter.consume({
          key: "signup:ip:1.2.3.4",
          limit: 3,
          windowMs: 60_000,
          now: at(i),
        }),
      );
    }
    assert.deepStrictEqual(
      results.map((r) => r.allowed),
      [true, true, true],
    );
  });

  it("denies the attempt past the limit and names when a slot frees", async function () {
    for (let i = 0; i < 2; i++) {
      await RateLimiter.consume({
        key: "k",
        limit: 2,
        windowMs: 60_000,
        now: at(i * 10),
      });
    }

    const denied = await RateLimiter.consume({
      key: "k",
      limit: 2,
      windowMs: 60_000,
      now: at(25),
    });

    assert.strictEqual(denied.allowed, false);
    // The oldest event (t=0) leaves the window at t=60 → 35 seconds from t=25.
    assert.strictEqual(denied.retryAfterSeconds, 35);
  });

  it("does not count a denied attempt against the window", async function () {
    for (let i = 0; i < 2; i++) {
      await RateLimiter.consume({
        key: "k",
        limit: 2,
        windowMs: 60_000,
        now: at(0),
      });
    }
    await RateLimiter.consume({
      key: "k",
      limit: 2,
      windowMs: 60_000,
      now: at(1),
    });

    assert.strictEqual(events.size, 2);
  });

  it("slides: an attempt after the oldest event left the window is allowed", async function () {
    await RateLimiter.consume({
      key: "k",
      limit: 1,
      windowMs: 60_000,
      now: at(0),
    });
    const inside = await RateLimiter.consume({
      key: "k",
      limit: 1,
      windowMs: 60_000,
      now: at(59),
    });
    const outside = await RateLimiter.consume({
      key: "k",
      limit: 1,
      windowMs: 60_000,
      now: at(60),
    });

    assert.strictEqual(inside.allowed, false);
    assert.strictEqual(outside.allowed, true);
  });

  it("release() gives the reservation back", async function () {
    const first = await RateLimiter.consume({
      key: "k",
      limit: 1,
      windowMs: 60_000,
      now: at(0),
    });
    await first.release();

    const second = await RateLimiter.consume({
      key: "k",
      limit: 1,
      windowMs: 60_000,
      now: at(1),
    });
    assert.strictEqual(second.allowed, true);
  });

  it("keeps keys apart", async function () {
    await RateLimiter.consume({
      key: "a",
      limit: 1,
      windowMs: 60_000,
      now: at(0),
    });
    const other = await RateLimiter.consume({
      key: "b",
      limit: 1,
      windowMs: 60_000,
      now: at(0),
    });
    assert.strictEqual(other.allowed, true);
  });

  it("never lets parallel attempts exceed the limit, and denied ones spend nothing", async function () {
    // Every attempt inserts before it counts, so a burst is never allowed
    // past the limit (it may be over-denied, never over-allowed); the denied
    // ones take their row back, so they cost the allowed ones nothing.
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        RateLimiter.consume({
          key: "k",
          limit: 5,
          windowMs: 60_000,
          now: at(0),
        }),
      ),
    );
    const allowed = results.filter((r) => r.allowed).length;
    assert.ok(allowed <= 5, `allowed ${allowed} of 12 with a limit of 5`);
    assert.ok(allowed >= 1, "a burst is not denied wholesale");
    assert.strictEqual(events.size, allowed);

    await results.find((r) => r.allowed).release();
    const next = await RateLimiter.consume({
      key: "k",
      limit: 5,
      windowMs: 60_000,
      now: at(1),
    });
    assert.strictEqual(next.allowed, true);
  });

  it("rejects a malformed limit instead of guessing", async function () {
    await assert.rejects(
      RateLimiter.consume({ key: "k", limit: 0, windowMs: 60_000 }),
      /limit/,
    );
    await assert.rejects(
      RateLimiter.consume({ key: "", limit: 1, windowMs: 60_000 }),
      /key/,
    );
  });
});

describe("RateLimiter.consumeAll", function () {
  beforeEach(function () {
    installInMemoryEvents();
  });

  afterEach(function () {
    sinon.restore();
  });

  it("applies every limit at once and reports the longest wait", async function () {
    const limits = [
      { key: "acc:short", limit: 1, windowMs: 60_000 },
      { key: "acc:long", limit: 5, windowMs: 3_600_000 },
    ];
    const first = await RateLimiter.consumeAll(limits, { now: at(0) });
    const second = await RateLimiter.consumeAll(limits, { now: at(10) });

    assert.strictEqual(first.allowed, true);
    assert.strictEqual(second.allowed, false);
    assert.strictEqual(second.retryAfterSeconds, 50);
  });

  it("does not spend the other limits when one denies", async function () {
    const limits = [
      { key: "acc:short", limit: 1, windowMs: 60_000 },
      { key: "acc:long", limit: 5, windowMs: 3_600_000 },
    ];
    await RateLimiter.consumeAll(limits, { now: at(0) });
    await RateLimiter.consumeAll(limits, { now: at(10) });

    const longOnly = await RateLimiter.consume({
      key: "acc:long",
      limit: 2,
      windowMs: 3_600_000,
      now: at(20),
    });
    assert.strictEqual(longOnly.allowed, true);
  });

  it("release() gives every reservation back", async function () {
    const limits = [
      { key: "a", limit: 1, windowMs: 60_000 },
      { key: "b", limit: 1, windowMs: 60_000 },
    ];
    const first = await RateLimiter.consumeAll(limits, { now: at(0) });
    await first.release();
    const second = await RateLimiter.consumeAll(limits, { now: at(1) });
    assert.strictEqual(second.allowed, true);
  });
});
