/**
 * An in-memory stand-in for the `RateLimitEvent` collection behind
 * `RateLimitEventManager`, with the semantics the limiter relies on: an
 * insert is visible to every count that follows it, also across "processes"
 * racing in the same tick; the window starts exclusive. Restored by
 * `sinon.restore()`.
 */

const sinon = require("sinon");
const RateLimitEventManager = require("../../src/commons/data-managers/rate-limit-event-manager");

/**
 * @returns {Map<string, { key: string, at: Date }>} The rows, by id
 */
function installInMemoryRateLimitEvents() {
  const events = new Map();
  let nextId = 1;

  const inWindow = (key, since) =>
    [...events.values()].filter((e) => e.key === key && e.at > since);

  sinon.stub(RateLimitEventManager, "record").callsFake(async (key, at) => {
    const id = `evt-${nextId++}`;
    events.set(id, { key, at: new Date(at) });
    return id;
  });
  sinon
    .stub(RateLimitEventManager, "countSince")
    .callsFake(async (key, since) => inWindow(key, since).length);
  sinon
    .stub(RateLimitEventManager, "oldestAtWithin")
    .callsFake(async (key, since, skip = 0) => {
      const sorted = inWindow(key, since)
        .map((e) => e.at)
        .sort((a, b) => a - b);
      return sorted[skip] ?? null;
    });
  sinon.stub(RateLimitEventManager, "remove").callsFake(async (id) => {
    events.delete(id);
  });

  return events;
}

module.exports = { installInMemoryRateLimitEvents };
