const express = require("express");
const router = express.Router({ mergeParams: true });
const AuthenticationController = require("../../authentication/controllers/authentication-controller");
const AccessPointController = require("../controllers/access-point-controller");

router.get(
  "/",
  AuthenticationController.isSignedIn,
  AccessPointController.getAccessPoints,
);

router.put(
  "/",
  AuthenticationController.isSignedIn,
  AccessPointController.storeAccessPoint,
);

router.get(
  "/:id",
  AuthenticationController.isSignedIn,
  AccessPointController.getAccessPoint,
);

router.delete(
  "/:id",
  AuthenticationController.isSignedIn,
  AccessPointController.removeAccessPoint,
);

module.exports = router;
