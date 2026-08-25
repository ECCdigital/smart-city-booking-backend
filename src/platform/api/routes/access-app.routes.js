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

// The Salto KS IQ activation wizard - provider-specific by nature: the IQ
// activation is a Salto concept, so these routes do not take a :provider.
router.get(
  "/salto-ks/iqs",
  AuthenticationController.isSignedIn,
  AccessAppController.saltoKsListIqs,
);

router.post(
  "/salto-ks/iqs/:iqId/activation/start",
  AuthenticationController.isSignedIn,
  AccessAppController.saltoKsStartIqActivation,
);

router.post(
  "/salto-ks/iqs/:iqId/activation/complete",
  AuthenticationController.isSignedIn,
  AccessAppController.saltoKsCompleteIqActivation,
);

router.delete(
  "/salto-ks/iqs/:iqId/activation",
  AuthenticationController.isSignedIn,
  AccessAppController.saltoKsDiscardIqActivation,
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
