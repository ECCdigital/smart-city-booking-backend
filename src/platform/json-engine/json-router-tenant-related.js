const express = require("express");
const JSONController = require("../json-engine/controllers/json-controller");
const { public: publicRoute } = require("../../commons/services/authorization");
const {
  publicTenantGate,
} = require("../../commons/services/supervision/public-tenant-gate");
const router = express.Router({ mergeParams: true });

router.get(
  "/bookables",
  publicRoute("json", "all"),
  publicTenantGate(),
  JSONController.getBookables,
);
router.get(
  "/bookables/:id",
  publicRoute("json", "all"),
  publicTenantGate(),
  JSONController.getBookable,
);
router.get(
  "/events",
  publicRoute("json", "all"),
  publicTenantGate(),
  JSONController.getEvents,
);
router.get(
  "/events/:id",
  publicRoute("json", "all"),
  publicTenantGate(),
  JSONController.getEvent,
);

module.exports = router;
