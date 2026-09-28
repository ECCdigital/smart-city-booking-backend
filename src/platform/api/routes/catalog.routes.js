const { asyncRouter } = require("../../../middleware/async-router");
const { authorize } = require("../../../commons/services/authorization");
const CatalogController = require("../controllers/catalog-controller");

// On the async router: a rejection reaches the central error handler.
const router = asyncRouter();

router.get(
  "/",
  authorize("tenant", "catalog"),
  CatalogController.getCatalogByTenant,
);
// A catalog that is not a single tenant's is the instance's: the marker
// decides `instanceCatalog.store` too, the handler reads it.
router.put(
  "/",
  authorize("tenant", "catalog", { also: ["instanceCatalog.store"] }),
  CatalogController.storeCatalog,
);

module.exports = router;
