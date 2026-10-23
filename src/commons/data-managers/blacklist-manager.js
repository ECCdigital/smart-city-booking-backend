const BlacklistEntryModel = require("./models/blacklistEntryModel");

/** A stored entry as a plain object, without the keys of MongoDB. */
const plain = (doc) => {
  if (!doc) return null;
  // eslint-disable-next-line no-unused-vars
  const { _id, __v, ...entry } = doc.toObject();
  return entry;
};

/**
 * Data manager of the blacklist (glossary „Blacklist“):
 * the entries of the instance in their own
 * collection. Instance-wide, so no read takes a tenant or a reach; the
 * routes are the instance owner's alone.
 */
class BlacklistManager {
  /** @returns {Promise<Object[]>} Every entry, newest first */
  static async getEntries() {
    const docs = await BlacklistEntryModel.find({}).sort({ createdAt: -1 });
    return docs.map(plain);
  }

  /** @returns {Promise<Object|null>} */
  static async getEntry(id) {
    return plain(await BlacklistEntryModel.findOne({ id }));
  }

  /**
   * @param {string} value A normalized address or domain
   * @returns {Promise<Object|null>}
   */
  static async getEntryByValue(value) {
    return plain(await BlacklistEntryModel.findOne({ value }));
  }

  /**
   * Stores a new entry; a second one with the same value fails at the
   * unique index (code 11000).
   * @returns {Promise<Object>}
   */
  static async insertEntry(entry) {
    return plain(await BlacklistEntryModel.create(entry));
  }

  /** @returns {Promise<Object|null>} The entry after the write */
  static async updateEntry(id, fields) {
    return plain(
      await BlacklistEntryModel.findOneAndUpdate(
        { id },
        { $set: fields },
        { new: true },
      ),
    );
  }

  static async removeEntry(id) {
    await BlacklistEntryModel.deleteOne({ id });
  }
}

module.exports = BlacklistManager;
