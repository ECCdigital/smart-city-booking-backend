const { asyncRouter } = require("../../../../middleware/async-router");
const { authorize } = require("../../../../commons/services/authorization");
const FavoriteControllerV2 = require("../controllers/favorite.controller");

const router = asyncRouter();

// The favorites list of the signed-in user (glossary "Favoritenliste"),
// across every tenant or narrowed by `?tenant=`: `self` at
// `favorite.readMine`, the service reads for the user under `DOMAIN` and
// asks the public projection about the offers - whoever asks.
router.get(
  "/",
  authorize("favorite", "readMine"),
  FavoriteControllerV2.getFavorites,
);

router.get(
  "/offers",
  authorize("favorite", "readMine"),
  FavoriteControllerV2.getFavoriteOffers,
);

module.exports = router;
