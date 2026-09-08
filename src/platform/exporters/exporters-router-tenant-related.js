const CsvExportController = require("./controllers/csv-export-controller");
const { authorize } = require("../../commons/services/authorization");
const { asyncRouter } = require("../../middleware/async-router");

const router = asyncRouter();

router.get(
  "/events/:id/bookings",
  authorize("exporter", "export"),
  CsvExportController.getEventBookings,
);

module.exports = router;
