const express = require("express");
const CsvExportController = require("./controllers/csv-export-controller");
const AuthenticationController = require("../authentication/controllers/authentication-controller");
const router = express.Router({ mergeParams: true });

router.get(
  "/events/:id/bookings",
  AuthenticationController.isSignedIn,
  CsvExportController.getEventBookings,
);

module.exports = router;
