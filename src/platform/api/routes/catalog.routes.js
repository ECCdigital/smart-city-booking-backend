const express = require("express");
const router = express.Router({ mergeParams: true });

const AuthenticationController = require("../../authentication/controllers/authentication-controller");
const CatalogController = require("../controllers/catalog-controller");
router.get(
  "/",
  AuthenticationController.isSignedIn,
  CatalogController.getCatalogByTenant,
);
router.put(
  "/",
  AuthenticationController.isSignedIn,
  CatalogController.storeCatalog,
);

module.exports = router;
