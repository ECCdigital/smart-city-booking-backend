const FavoriteService = require("../../../../commons/services/favorite/favorite-service");
const { reachesOf } = require("../../../../commons/services/authorization");

/**
 * The favorites of the signed-in user (glossary "Favorit"): marking an
 * offer of a tenant and removing the mark. The route's marker decides
 * `favorite.write` (`self`) and the read of the offer (`also`); the
 * handler hands the decided reaches on and answers what the service
 * returns. Errors go to the central error handler.
 */
class FavoriteControllerV2 {
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
