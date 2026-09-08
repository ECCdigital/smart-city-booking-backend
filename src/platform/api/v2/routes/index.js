const express = require("express");
const router = express.Router({ mergeParams: true });

// Before the tenant routes: `instance` is the scope segment of the instance
// media library (§4.9) and `dashboard` the cross-tenant dashboard, so
// neither must be read as a tenant id.
router.use("/instance/media", require("./instance.media.routes"));
router.use("/dashboard", require("./dashboard.routes"));

router.use("/:tenant/checkout", require("./tenant.checkout.routes"));
router.use("/:tenant/coupon", require("./tenant.coupon.routes"));
router.use("/:tenant/bookings", require("./tenant.booking-status.routes"));
router.use("/:tenant/media", require("./tenant.media.routes"));
router.use("/:tenant/dashboard", require("./tenant.dashboard.routes"));

module.exports = router;
