const { asyncRouter } = require("../../../../middleware/async-router");
const BookingStatusControllerV2 = require("../controllers/booking-status.controller");

const router = asyncRouter();

router.get("/:ids/status", BookingStatusControllerV2.getBookingStatus);

module.exports = router;
