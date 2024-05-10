const express = require("express");
const CsvExportController = require("./controllers/csv-export-controller");
const router = express.Router({ mergeParams: true });

router.get("/events/:id/bookings", CsvExportController.getEventBookings);

module.exports = router;
