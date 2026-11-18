const { asyncRouter } = require("../../../../middleware/async-router");
const { authorize } = require("../../../../commons/services/authorization");
const FavoriteControllerV2 = require("../controllers/favorite.controller");

const router = asyncRouter();

// Marking needs the offer within the user's reach at this moment: the
// public's projection, or the staff's management view (ADR 0003). The
// marker names both reads; the service takes the one of the target type.
router.put(
  "/:targetType/:targetId",
  authorize("favorite", "write", {
    also: ["bookable.readPublic", "event.read"],
  }),
  FavoriteControllerV2.markFavorite,
);

router.delete(
  "/:targetType/:targetId",
  authorize("favorite", "write"),
  FavoriteControllerV2.removeFavorite,
);

module.exports = router;
