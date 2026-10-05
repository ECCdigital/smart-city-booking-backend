const { Favorite } = require("../entities/favorite/favorite");
const FavoriteModel = require("./models/favoriteModel");

/**
 * Data Manager for favorites (glossary "Favorit"). A favorite is the
 * user's alone: every read names the user, and the reads take the reach
 * the caller reads under (ADR 0002) - the domain's, for the routes of the
 * favorites list (`self` reaches no record, the service reads for the
 * user under `DOMAIN`). A favorite has no owner key: no entry of the
 * rights table reaches it as `own` or `any`.
 */
class FavoriteManager {
  /** The reach is required: a read without one is a programming error. */
  static _requireReach(scope) {
    if (scope?.reach === undefined) {
      throw new Error("authorization: favorite read without a reach");
    }
  }

  /** The four keys of a favorite as a query condition. */
  static _keyOf(userId, tenantId, targetType, targetId) {
    return { userId, tenantId, targetType, targetId };
  }

  /**
   * The favorites of a user, across every tenant or within one.
   *
   * @param {string} userId The user
   * @param {string|null} tenantId The tenant, or null for every tenant
   * @param {{reach: string, userId?: string|null}} scope The reach the
   *   caller reads under (ADR 0002); none is a programming error
   * @returns {Promise<Favorite[]>} The favorites, newest first
   */
  static async getFavorites(userId, tenantId, scope) {
    FavoriteManager._requireReach(scope);
    const docs = await FavoriteModel.find({
      userId,
      ...(tenantId ? { tenantId } : {}),
    }).sort({ created: -1 });
    return docs.map((doc) => doc.toEntity());
  }

  /**
   * One favorite of a user, by its target.
   *
   * @param {string} userId
   * @param {string} tenantId
   * @param {string} targetType `bookable` or `event`
   * @param {string} targetId
   * @param {{reach: string, userId?: string|null}} scope As of `getFavorites`
   * @returns {Promise<Favorite|null>}
   */
  static async getFavorite(userId, tenantId, targetType, targetId, scope) {
    FavoriteManager._requireReach(scope);
    const doc = await FavoriteModel.findOne(
      FavoriteManager._keyOf(userId, tenantId, targetType, targetId),
    );
    return doc ? doc.toEntity() : null;
  }

  /**
   * How many favorites a user holds: a counter, no record.
   *
   * @param {string} userId
   * @returns {Promise<number>}
   */
  static async countFavorites(userId) {
    return FavoriteModel.countDocuments({ userId });
  }

  /**
   * Stores a favorite: inserts it, or finds the one the user already set on
   * the same target. The snapshot and `created` of an existing favorite
   * stay as they are - a second mark changes nothing.
   *
   * @param {Favorite|Object} favorite
   * @returns {Promise<Favorite>} The stored favorite
   */
  static async storeFavorite(favorite) {
    const entity =
      favorite instanceof Favorite ? favorite : new Favorite(favorite);
    entity.validate();
    const { userId, tenantId, targetType, targetId, ...snapshot } =
      entity.toDocument();
    const doc = await FavoriteModel.findOneAndUpdate(
      FavoriteManager._keyOf(userId, tenantId, targetType, targetId),
      { $setOnInsert: { userId, tenantId, targetType, targetId, ...snapshot } },
      { upsert: true, new: true },
    );
    return doc.toEntity();
  }

  /**
   * Removes a favorite of a user. Nothing happens where there is none.
   *
   * @param {string} userId
   * @param {string} tenantId
   * @param {string} targetType
   * @param {string} targetId
   * @returns {Promise<void>}
   */
  static async removeFavorite(userId, tenantId, targetType, targetId) {
    await FavoriteModel.deleteOne(
      FavoriteManager._keyOf(userId, tenantId, targetType, targetId),
    );
  }

  /**
   * Moves the favorites of a user to a new user id, with the other
   * references of the user (`UserService.changeUserId`).
   *
   * @param {string} previousUserId
   * @param {string} newUserId
   * @param {import("mongoose").ClientSession|null} [session]
   * @returns {Promise<void>}
   */
  static async reassignUserId(previousUserId, newUserId, session = null) {
    const options = session ? { session } : {};
    await FavoriteModel.updateMany(
      { userId: previousUserId },
      { $set: { userId: newUserId } },
      options,
    );
  }

  /**
   * Removes every favorite of a user, with the user.
   *
   * @param {string} userId
   * @returns {Promise<void>}
   */
  static async removeFavoritesOfUser(userId) {
    await FavoriteModel.deleteMany({ userId });
  }
}

module.exports = FavoriteManager;
