const express = require("express");
const JSONController = require("../json-engine/controllers/json-controller");
const { public: publicRoute } = require("../../commons/services/authorization");
const router = express.Router({ mergeParams: true });

router.get(
  "/bookables",
  publicRoute("json", "all"),
  JSONController.getBookables,
);
router.get(
  "/bookables/:id",
  publicRoute("json", "all"),
  JSONController.getBookable,
);
router.get("/events", publicRoute("json", "all"), JSONController.getEvents);
router.get("/events/:id", publicRoute("json", "all"), JSONController.getEvent);

module.exports = router;
