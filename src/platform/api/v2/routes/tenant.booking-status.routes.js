const { asyncRouter } = require("../../../../middleware/async-router");
const BookingStatusControllerV2 = require("../controllers/booking-status.controller");
const { publicRoute } = require("../../../../commons/services/authorization");

const router = asyncRouter();

router.get(
  "/:ids/status",
  publicRoute("bookingStatus", "all"),
  BookingStatusControllerV2.getBookingStatus,
);

module.exports = router;
