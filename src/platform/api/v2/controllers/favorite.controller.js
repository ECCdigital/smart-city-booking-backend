const FavoriteService = require("../../../../commons/services/favorite/favorite-service");
const { reachesOf } = require("../../../../commons/services/authorization");
const { BadRequestError } = require("../../../../errors/BaseError");

/**
 * The tenant a list route is narrowed to, from `?tenant=`: none without
 * the parameter or with an empty one; anything but one string is refused.
 *
 * @param {import("express").Request} req
 * @returns {string|null}
 * @throws {BadRequestError} `favorite.invalid_tenant_filter`
 */
function tenantFilterOf(req) {
  const { tenant } = req.query;
  if (tenant === undefined || tenant === "") {
    return null;
  }
  if (typeof tenant !== "string") {
    throw new BadRequestError("favorite.invalid_tenant_filter");
  }
  return tenant;
}

/**
 * The favorites of the signed-in user (glossary "Favorit"): marking an
 * offer of a tenant and removing the mark, and reading the list
 * (glossary "Favoritenliste") across tenants. The route's marker decides
 * `favorite.write` or `favorite.readMine` (`self`) and, when marking, the
 * read of the offer (`also`); the handler hands the decided reaches on
 * and answers what the service returns. Errors go to the central error
 * handler.
 */
class FavoriteControllerV2 {
  /**
   * `GET /api/v2/favorites?tenant=`: the references of the user's
   * favorites, across every tenant or within one.
   */
  static async getFavorites(req, res) {
    const favorites = await FavoriteService.getFavorites({
      userId: req.principal.userId,
      tenantId: tenantFilterOf(req),
    });
    return res
      .status(200)
      .json(favorites.map((favorite) => favorite.toReference()));
  }

  /**
   * `GET /api/v2/favorites/offers?tenant=`: the user's favorites with
   * their state and, where available, the offer in its public projection.
   */
  static async getFavoriteOffers(req, res) {
    const entries = await FavoriteService.getFavoriteOffers({
      userId: req.principal.userId,
      tenantId: tenantFilterOf(req),
    });
    return res.status(200).json(entries);
  }

  /**
   * `PUT /api/v2/:tenant/favorites/:targetType/:targetId`: marks the offer
   * and answers the favorite. Idempotent.
   */
  static async markFavorite(req, res) {
    const { tenant, targetType, targetId } = req.params;
    const favorite = await FavoriteService.markFavorite({
      userId: req.principal.userId,
      tenantId: tenant,
      targetType,
      targetId,
      reaches: reachesOf(req),
    });
    return res.status(200).json(favorite.toResponse());
  }

  /**
   * `DELETE /api/v2/:tenant/favorites/:targetType/:targetId`: removes the
   * favorite, whether or not there was one.
   */
  static async removeFavorite(req, res) {
    const { tenant, targetType, targetId } = req.params;
    await FavoriteService.unmarkFavorite({
      userId: req.principal.userId,
      tenantId: tenant,
      targetType,
      targetId,
    });
    return res.status(204).end();
  }
}

module.exports = FavoriteControllerV2;
