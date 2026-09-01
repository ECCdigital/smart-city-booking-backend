const express = require("express");
const router = express.Router({ mergeParams: true });

// Before the tenant routes: `instance` is the scope segment of the instance
// media library (§4.9), so it must not be read as a tenant id.
router.use("/instance/media", require("./instance.media.routes"));

router.use("/:tenant/checkout", require("./tenant.checkout.routes"));
router.use("/:tenant/coupon", require("./tenant.coupon.routes"));
router.use("/:tenant/bookings", require("./tenant.booking-status.routes"));
router.use("/:tenant/media", require("./tenant.media.routes"));

module.exports = router;
