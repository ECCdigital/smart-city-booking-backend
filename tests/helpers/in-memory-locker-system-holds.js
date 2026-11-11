/**
 * An in-memory stand-in for the `LockerSystemHold` collection behind
 * `LockerSystemHoldManager`, with the guarantee the mutex relies on: of
 * two acquires of the same key, only one wins until the hold is released
 * or has expired. Each acquire yields once before it checks, as a database
 * round trip would, so racing holds interleave; it yields on a microtask, so
 * a test may fake every timer. Restored by `sinon.restore()`.
 */

const sinon = require("sinon");
const LockerSystemHoldManager = require("../../src/commons/data-managers/locker-system-hold-manager");

/**
 * @returns {Map<string, { holder: string, expiresAt: Date }>} The holds, by key
 */
function installInMemoryLockerSystemHolds() {
  const holds = new Map();

  sinon
    .stub(LockerSystemHoldManager, "acquire")
    .callsFake(async (key, { holder, now, ttlMs }) => {
      await Promise.resolve();
      const current = holds.get(key);
      if (current && current.expiresAt > now) {
        return false;
      }
      holds.set(key, {
        holder,
        expiresAt: new Date(now.getTime() + ttlMs),
      });
      return true;
    });
  sinon
    .stub(LockerSystemHoldManager, "release")
    .callsFake(async (key, holder) => {
      if (holds.get(key)?.holder === holder) {
        holds.delete(key);
      }
    });

  return holds;
}

module.exports = { installInMemoryLockerSystemHolds };
