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
router.put("/", authorize("tenant", "catalog"), CatalogController.storeCatalog);

module.exports = router;
