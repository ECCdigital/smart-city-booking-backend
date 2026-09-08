const express = require("express");
const router = express.Router({ mergeParams: true });
const { tokenAuthorized } = require("../../../commons/services/authorization");
const AccessWebhookController = require("../controllers/access-webhook-controller");

// The provider authorizes itself with the secret it was registered with; the
// handler checks it, as every token-authorized route does (spec §2.4).
router.post(
  "/:provider/:tenant",
  tokenAuthorized(),
  AccessWebhookController.handle,
);

module.exports = router;
