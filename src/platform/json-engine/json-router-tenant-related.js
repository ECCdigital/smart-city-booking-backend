const express = require("express");
const JSONController = require("../json-engine/controllers/json-controller");
const router = express.Router({ mergeParams: true });


router.get("/bookables", JSONController.getBookables);
router.get("/bookables/:id", JSONController.getBookable);
router.get("/events", JSONController.getEvents);
router.get("/events/:id", JSONController.getEvent);


module.exports = router;
