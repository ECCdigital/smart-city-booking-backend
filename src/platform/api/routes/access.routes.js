const express = require("express");
const router = express.Router({ mergeParams: true });
const AuthenticationController = require("../../authentication/controllers/authentication-controller");
const AccessController = require("../controllers/access-controller");

router.post(
  "/:accessPointId/open",
  AuthenticationController.isSignedIn,
  AccessController.open,
);

router.get(
  "/:accessPointId/open-status",
  AuthenticationController.isSignedIn,
  AccessController.getOpenStatus,
);

router.get(
  "/",
  AuthenticationController.isSignedIn,
  AccessController.getAccessPoints,
);

module.exports = router;