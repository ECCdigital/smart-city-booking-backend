/**
 * The instance catalog routes (`/api/catalog...`), on the async router: a
 * rejection of a handler goes to `next` and the central error handler
 * answers it in the one JSON form - a `NotFoundError` as 404, a
 * `ValidationError` as 400 with `details[]`, anything unexpected as 500.
 * The rights markers and the order are the instance router's as before;
 * the slug route stays last, behind every fixed `/catalog/...` path.
 */

const { asyncRouter } = require("../../../middleware/async-router");
const {
  authorize,
  publicRoute,
} = require("../../../commons/services/authorization");
const CatalogController = require("../controllers/catalog-controller");

const router = asyncRouter();

router.get(
  "/catalog",
  authorize("instanceCatalog", "read"),
  CatalogController.getInstanceCatalog,
);
router.get(
  "/catalog/public",
  publicRoute("instanceCatalog", "readPublic"),
  CatalogController.getPublicCatalog,
);
router.get(
  "/catalog/mode",
  publicRoute("instanceCatalog", "mode"),
  CatalogController.getPortalMode,
);
router.get(
  "/catalog/bundle",
  publicRoute("instanceCatalog", "readPublic"),
  CatalogController.getCatalogBundle,
);
router.put(
  "/catalog",
  authorize("instanceCatalog", "store"),
  CatalogController.storeInstanceCatalog,
);
// The Hero Editor: the layout and the Background of the instance, read and
// written as one object, and previewed without a write. Fixed paths, so they
// stand ahead of `/catalog/:slug` like every other one.
router.get(
  "/catalog/hero-layout",
  authorize("instanceCatalog", "read"),
  CatalogController.getHeroLayout,
);
router.put(
  "/catalog/hero-layout",
  authorize("instanceCatalog", "store"),
  CatalogController.storeHeroLayout,
);
router.post(
  "/catalog/hero-layout/preview",
  authorize("instanceCatalog", "store"),
  CatalogController.previewHeroLayout,
);
router.get(
  "/catalog/themes/:slug",
  publicRoute("instanceCatalog", "themes"),
  CatalogController.getTheme,
);
router.get(
  "/catalog/themes",
  publicRoute("instanceCatalog", "themes"),
  CatalogController.getTheme,
);
router.get(
  "/catalog/availability/:slug",
  authorize("instanceCatalog", "slugAvailability"),
  CatalogController.slugAvailability,
);
router.get(
  "/catalog/:slug",
  publicRoute("instanceCatalog", "readPublic"),
  CatalogController.getCatalogBySlug,
);

module.exports = router;
