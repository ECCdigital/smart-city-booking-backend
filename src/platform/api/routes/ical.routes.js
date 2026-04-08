const express = require("express");
const router = express.Router({ mergeParams: true });
const ICalController = require("../controllers/ical-controller");

// Events
router.get("/events", ICalController.getEventsIcal);
router.get("/events/:id", ICalController.getEventIcal);

// Feed
router.get("/feed/events", ICalController.getEventsFeed);
router.get("/feed/events/:id", ICalController.getEventFeed);

// Bookings
router.get("/bookings", ICalController.getBookingsIcal);
router.get("/bookings/:id", ICalController.getBookingIcal);

module.exports = router;
