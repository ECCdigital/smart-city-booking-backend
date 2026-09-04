const express = require("express");
const BookableHtmlController = require("./controllers/html-controller");
const { public: publicRoute } = require("../../commons/services/authorization");
const router = express.Router({ mergeParams: true });

router.get(
  "/bookables",
  publicRoute("html", "all"),
  BookableHtmlController.getBookables,
);
router.get(
  "/bookables/:id",
  publicRoute("html", "all"),
  BookableHtmlController.getBookable,
);
router.get(
  "/events",
  publicRoute("html", "all"),
  BookableHtmlController.getEvents,
);
router.get(
  "/events/:id",
  publicRoute("html", "all"),
  BookableHtmlController.getEvent,
);

module.exports = router;
