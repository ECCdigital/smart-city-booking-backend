const express = require("express");
const BookableHtmlController = require("./controllers/html-controller");
const { public: publicRoute } = require("../../commons/services/authorization");
const {
  publicTenantGate,
} = require("../../commons/services/supervision/public-tenant-gate");
const router = express.Router({ mergeParams: true });

router.get(
  "/bookables",
  publicRoute("html", "all"),
  publicTenantGate(),
  BookableHtmlController.getBookables,
);
router.get(
  "/bookables/:id",
  publicRoute("html", "all"),
  publicTenantGate(),
  BookableHtmlController.getBookable,
);
router.get(
  "/events",
  publicRoute("html", "all"),
  publicTenantGate(),
  BookableHtmlController.getEvents,
);
router.get(
  "/events/:id",
  publicRoute("html", "all"),
  publicTenantGate(),
  BookableHtmlController.getEvent,
);

module.exports = router;
