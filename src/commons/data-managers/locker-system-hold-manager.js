const LockerSystemHoldModel = require("./models/lockerSystemHoldModel");

const DUPLICATE_KEY = 11000;

/**
 * The store behind `LockerSystemMutex`: one row per held locker system.
 * The collection is the only state shared between server processes.
 */
class LockerSystemHoldManager {
  /**
   * Takes the hold of `key` for `holder`, if nobody holds it or the hold
   * has expired - in one conditional upsert: an unexpired row does not
   * match, so the upsert inserts a second row with the same key and the
   * unique index refuses it.
   *
   * @param {string} key The held locker system
   * @param {Object} options
   * @param {string} options.holder Who takes the hold, for `release`
   * @param {Date} options.now
   * @param {number} options.ttlMs After this long the hold expires
   * @returns {Promise<boolean>} Whether the hold was taken
   */
  static async acquire(key, { holder, now, ttlMs }) {
    try {
      await LockerSystemHoldModel.updateOne(
        { key, expiresAt: { $lte: now } },
        { $set: { holder, expiresAt: new Date(now.getTime() + ttlMs) } },
        { upsert: true },
      );
      return true;
    } catch (error) {
      if (error?.code === DUPLICATE_KEY) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Gives the hold back - only the holder's own: a hold that expired and
   * was taken over by another holder stays.
   *
   * @param {string} key The held locker system
   * @param {string} holder Who took the hold
   */
  static async release(key, holder) {
    await LockerSystemHoldModel.deleteOne({ key, holder });
  }
}

module.exports = LockerSystemHoldManager;
