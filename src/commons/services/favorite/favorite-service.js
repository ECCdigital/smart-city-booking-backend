/**
 * The favorites of a signed-in user (glossary "Favorit", "Favoritenliste"):
 * marking an offer and removing the mark, both idempotent. Favorites are
 * the user's alone, so the service reads them for the user under `DOMAIN`
 * (`self` reaches no record, as "my bookings" does); the offer itself is
 * read with the reach the route decided for it - the public's, or the
 * staff's management view (`also` on the marker: `bookable.readPublic`,
 * `event.read`) - so a user marks only what they reach at this moment. A
 * tenant without a public projection has nothing to mark (`404
 * tenant_not_found`, ADR 0003).
 */

const { BookableManager } = require("../../data-managers/bookable-manager");
const EventManager = require("../../data-managers/event-manager");
const FavoriteManager = require("../../data-managers/favorite-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const {
  Favorite,
  FavoriteTargetType,
  isFavoriteTargetType,
} = require("../../entities/favorite/favorite");
const { DOMAIN } = require("../authorization/reach");
const {
  BadRequestError,
  ConflictError,
  NotFoundError,
} = require("../../../errors/BaseError");

/** The favorites a user may hold, without `FAVORITES_MAX_PER_USER`. */
const DEFAULT_MAX_FAVORITES_PER_USER = 200;

/**
 * The entry of the rights table a route names on its marker for the read
 * of each kind of target, and the manager that reads it.
 */
const TARGETS = {
  [FavoriteTargetType.BOOKABLE]: {
    entry: "bookable.readPublic",
    read: (id, tenantId, scope) =>
      BookableManager.getBookable(id, tenantId, scope),
    titleOf: (bookable) => bookable.title ?? "",
  },
  [FavoriteTargetType.EVENT]: {
    entry: "event.read",
    read: (id, tenantId, scope) => EventManager.getEvent(id, tenantId, scope),
    titleOf: (event) => event.information?.name ?? "",
  },
};

/**
 * The limit per user: `FAVORITES_MAX_PER_USER`, read at call time; a
 * value that is not a positive integer falls back to the default.
 *
 * @returns {number}
 */
function maxFavoritesPerUser() {
  const value = Number(process.env.FAVORITES_MAX_PER_USER);
  return Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_MAX_FAVORITES_PER_USER;
}

function targetOf(targetType) {
  if (!isFavoriteTargetType(targetType)) {
    throw new BadRequestError("favorite.invalid_target_type", { targetType });
  }
  return TARGETS[targetType];
}

class FavoriteService {
  /**
   * Marks an offer as a favorite of the user. Idempotent: an offer already
   * marked answers the existing favorite, snapshot untouched.
   *
   * @param {Object} params
   * @param {string} params.userId The signed-in user
   * @param {string} params.tenantId The tenant of the offer
   * @param {string} params.targetType `bookable` or `event`
   * @param {string} params.targetId The id of the offer
   * @param {Object<string, string|null>} params.reaches The reaches the
   *   route decided (`reachesOf(req)`): the read of the offer takes the
   *   one of its entry
   * @returns {Promise<Favorite>} The favorite
   * @throws {BadRequestError} `favorite.invalid_target_type`
   * @throws {NotFoundError} `favorite.offer_not_found` for an offer the
   *   user does not reach, `tenant_not_found` for a tenant without a
   *   public projection
   * @throws {ConflictError} `favorite.limit_reached` at the limit
   */
  static async markFavorite({
    userId,
    tenantId,
    targetType,
    targetId,
    reaches,
  }) {
    const target = targetOf(targetType);
    const offer = await target.read(targetId, tenantId, {
      reach: reaches?.[target.entry] ?? undefined,
      userId: reaches?.userId ?? userId,
    });
    if (!offer) {
      throw new NotFoundError("favorite.offer_not_found", {
        tenantId,
        targetType,
        targetId,
      });
    }

    const existing = await FavoriteManager.getFavorite(
      userId,
      tenantId,
      targetType,
      targetId,
      DOMAIN,
    );
    if (existing) {
      return existing;
    }

    const limit = maxFavoritesPerUser();
    if ((await FavoriteManager.countFavorites(userId)) >= limit) {
      throw new ConflictError("favorite.limit_reached", { limit });
    }

    const tenant = await TenantManager.getTenant(tenantId, DOMAIN);
    return FavoriteManager.storeFavorite(
      Favorite.create({
        userId,
        tenantId,
        targetType,
        targetId,
        title: target.titleOf(offer),
        tenantName: tenant?.name ?? "",
      }),
    );
  }

  /**
   * Removes a favorite of the user. Idempotent: nothing to remove is fine.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.tenantId
   * @param {string} params.targetType `bookable` or `event`
   * @param {string} params.targetId
   * @returns {Promise<void>}
   * @throws {BadRequestError} `favorite.invalid_target_type`
   */
  static async unmarkFavorite({ userId, tenantId, targetType, targetId }) {
    targetOf(targetType);
    await FavoriteManager.removeFavorite(
      userId,
      tenantId,
      targetType,
      targetId,
    );
  }
}

module.exports = FavoriteService;
module.exports.DEFAULT_MAX_FAVORITES_PER_USER = DEFAULT_MAX_FAVORITES_PER_USER;
module.exports.maxFavoritesPerUser = maxFavoritesPerUser;
