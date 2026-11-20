const RateLimitEventModel = require("./models/rateLimitEventModel");

/**
 * The store behind `RateLimiter`: one row per counted attempt. The limiter
 * inserts first and counts second, so the count every racing process sees
 * already includes its own row - the collection is the only shared state.
 */
class RateLimitEventManager {
  /**
   * @param {string} key The limited subject
   * @param {Date} at When the attempt happened
   * @returns {Promise<string>} The id of the row, for `remove`
   */
  static async record(key, at) {
    const row = await RateLimitEventModel.create({ key, at });
    return String(row._id);
  }

  /**
   * Several attempts of one key at once, in one round trip.
   *
   * @param {string} key The limited subject
   * @param {Date} at When the attempts happened
   * @param {number} count How many rows
   * @returns {Promise<string[]>} The ids of the rows, for `removeMany`
   */
  static async recordMany(key, at, count) {
    const rows = await RateLimitEventModel.insertMany(
      Array.from({ length: count }, () => ({ key, at })),
    );
    return rows.map((row) => String(row._id));
  }

  /**
   * @param {string} key The limited subject
   * @param {Date} since Start of the window (exclusive)
   * @returns {Promise<number>} Attempts of the key in the window
   */
  static async countSince(key, since) {
    return RateLimitEventModel.countDocuments({ key, at: { $gt: since } });
  }

  /**
   * @param {string} key The limited subject
   * @param {Date} since Start of the window (exclusive)
   * @param {number} [skip=0] How many of the oldest to pass over
   * @returns {Promise<Date|null>} The `at` of the (skip+1)-th oldest attempt
   */
  static async oldestAtWithin(key, since, skip = 0) {
    const row = await RateLimitEventModel.findOne(
      { key, at: { $gt: since } },
      { at: 1 },
    )
      .sort({ at: 1 })
      .skip(skip)
      .lean();
    return row ? row.at : null;
  }

  /**
   * @param {string} id The row id from `record`
   */
  static async remove(id) {
    await RateLimitEventModel.deleteOne({ _id: id });
  }

  /**
   * @param {string[]} ids The row ids from `recordMany`
   */
  static async removeMany(ids) {
    await RateLimitEventModel.deleteMany({ _id: { $in: ids } });
  }
}

module.exports = RateLimitEventManager;
