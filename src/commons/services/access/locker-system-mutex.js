const { v4: uuidv4 } = require("uuid");
const bunyan = require("bunyan");
const LockerSystemHoldManager = require("../../data-managers/locker-system-hold-manager");
const { ServiceUnavailableError } = require("../../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "locker-system-mutex.js",
  level: process.env.LOG_LEVEL,
});

/** A hold expires after this long, so a process that died holding frees it. */
const TTL_MS = 15000;
/** A hold gives up waiting after this long: past one expiry, with room. */
const WAIT_MS = 20000;
/** How often a waiting hold asks again. */
const POLL_MS = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A short mutex per locker system (glossary "Schließfachanlage"), shared
 * by every server process through MongoDB. The platform allocates a
 * compartment under it: reading the occupancy, choosing the compartment
 * and saving the booking happen while holding the locker system, so two
 * allocations at the same locker system run one after the other, while
 * other locker systems do not wait. A hold expires, so a process that
 * died holding blocks the locker system for one expiry at most.
 */
class LockerSystemMutex {
  /**
   * Runs `work` while holding the locker system: waits while another holds
   * it, and gives it back when the work is done or has failed.
   *
   * @template T
   * @param {{tenantId: string, id: string}} lockerSystem The access point
   *   of the locker system
   * @param {() => Promise<T>} work Must end well within `ttlMs`; once the
   *   hold has expired, another may hold the locker system as well
   * @param {Object} [options]
   * @param {number} [options.ttlMs] After this long the hold expires
   * @param {number} [options.waitMs] After this long waiting gives up
   * @returns {Promise<T>} What the work answers
   * @throws {ServiceUnavailableError} `locker_system_busy` when the locker
   *   system stayed held for `waitMs`; the work did not run
   */
  static async hold(
    lockerSystem,
    work,
    { ttlMs = TTL_MS, waitMs = WAIT_MS } = {},
  ) {
    const key = `${lockerSystem.tenantId}:${lockerSystem.id}`;
    const holder = uuidv4();
    const giveUpAt = Date.now() + waitMs;

    while (
      !(await LockerSystemHoldManager.acquire(key, {
        holder,
        now: new Date(),
        ttlMs,
      }))
    ) {
      if (Date.now() >= giveUpAt) {
        throw new ServiceUnavailableError("locker_system_busy", {
          accessPointId: lockerSystem.id,
        });
      }
      await sleep(POLL_MS);
    }

    try {
      return await work();
    } finally {
      // The hold expires on its own; the work's outcome stands.
      await LockerSystemHoldManager.release(key, holder).catch((error) => {
        logger.warn(
          { err: error, tenantId: lockerSystem.tenantId, key },
          "Could not release locker system hold",
        );
      });
    }
  }
}

module.exports = LockerSystemMutex;
