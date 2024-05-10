const express = require("express");
const BookableHtmlController = require("./controllers/html-controller");
const router = express.Router({ mergeParams: true });

router.get("/bookables", BookableHtmlController.getBookables);
router.get("/bookables/:id", BookableHtmlController.getBookable);
router.get("/events", BookableHtmlController.getEvents);
router.get("/events/:id", BookableHtmlController.getEvent);

module.exports = router;
