const express = require("express");
const router = express.Router({ mergeParams: true });

router.use("/:tenant/checkout", require("./tenant.checkout.routes"));
router.use("/:tenant/coupon", require("./tenant.coupon.routes"));
router.use("/:tenant/bookings", require("./tenant.booking-status.routes"));

module.exports = router;
