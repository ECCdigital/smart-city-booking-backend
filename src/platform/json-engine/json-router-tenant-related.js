const express = require("express");
const JSONController = require("../json-engine/controllers/json-controller");
const { optionalAuth } = require("../../middleware/auth-middleware");
const router = express.Router({ mergeParams: true });

// Alle JSON-Endpoints verwenden optionalAuth für flexible Authentifizierung
router.get("/bookables", optionalAuth, JSONController.getBookables);
router.get("/bookables/:id", optionalAuth, JSONController.getBookable);
router.get("/events", optionalAuth, JSONController.getEvents);
router.get("/events/:id", optionalAuth, JSONController.getEvent);


module.exports = router;
