const express = require("express");
const router = express.Router({ mergeParams: true });
const AuthenticationController = require("../../authentication/controllers/authentication-controller");
const AccessAppController = require("../controllers/access-app-controller");

router.get(
  "/providers",
  AuthenticationController.isSignedIn,
  AccessAppController.getProviders,
);

router.get(
  "/:provider/access-points",
  AuthenticationController.isSignedIn,
  AccessAppController.getAccessPoints,
);

router.post(
  "/:provider/test",
  AuthenticationController.isSignedIn,
  AccessAppController.testConnection,
);

router.post(
  "/:provider/webhook/register",
  AuthenticationController.isSignedIn,
  AccessAppController.registerWebhook,
);

router.post(
  "/:provider/webhook/unregister",
  AuthenticationController.isSignedIn,
  AccessAppController.unregisterWebhook,
);

module.exports = router;
