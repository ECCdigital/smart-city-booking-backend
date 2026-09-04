const express = require("express");
const router = express.Router({ mergeParams: true });

const { authorize } = require("../../../commons/services/authorization");
const CatalogController = require("../controllers/catalog-controller");

router.get(
  "/",
  authorize("tenant", "catalog"),
  CatalogController.getCatalogByTenant,
);
router.put("/", authorize("tenant", "catalog"), CatalogController.storeCatalog);

module.exports = router;
