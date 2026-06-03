const express = require("express");
const router = express.Router({ mergeParams: true });
const AccessWebhookController = require("../controllers/access-webhook-controller");

router.post("/:provider/:tenant", AccessWebhookController.handle);

module.exports = router;
