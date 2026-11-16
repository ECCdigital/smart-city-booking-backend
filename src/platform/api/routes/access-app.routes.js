const express = require("express");
const router = express.Router({ mergeParams: true });
const { authorize } = require("../../../commons/services/authorization");
const AccessAppController = require("../controllers/access-app-controller");

router.get(
  "/providers",
  authorize("accessApp", "read"),
  AccessAppController.getProviders,
);

router.get(
  "/:provider/access-points",
  authorize("accessApp", "read"),
  AccessAppController.getAccessPoints,
);

// The Salto KS IQ activation wizard - provider-specific by nature: the IQ
// activation is a Salto concept, so these routes do not take a :provider.
router.get(
  "/salto-ks/iqs",
  authorize("accessApp", "manage"),
  AccessAppController.saltoKsListIqs,
);

router.post(
  "/salto-ks/iqs/:iqId/activation/start",
  authorize("accessApp", "manage"),
  AccessAppController.saltoKsStartIqActivation,
);

router.post(
  "/salto-ks/iqs/:iqId/activation/complete",
  authorize("accessApp", "manage"),
  AccessAppController.saltoKsCompleteIqActivation,
);

router.delete(
  "/salto-ks/iqs/:iqId/activation",
  authorize("accessApp", "manage"),
  AccessAppController.saltoKsDiscardIqActivation,
);

// The access application of one provider, saved, switched and removed on
// its own (tickets#1101) - never the whole tenant.
router.put(
  "/:provider",
  authorize("accessApp", "manage"),
  AccessAppController.saveApplication,
);

router.put(
  "/:provider/active",
  authorize("accessApp", "manage"),
  AccessAppController.setApplicationActive,
);

router.delete(
  "/:provider",
  authorize("accessApp", "manage"),
  AccessAppController.removeApplication,
);

router.post(
  "/:provider/test",
  authorize("accessApp", "manage"),
  AccessAppController.testConnection,
);

router.post(
  "/:provider/webhook/register",
  authorize("accessApp", "manage"),
  AccessAppController.registerWebhook,
);

router.post(
  "/:provider/webhook/unregister",
  authorize("accessApp", "manage"),
  AccessAppController.unregisterWebhook,
);

module.exports = router;
