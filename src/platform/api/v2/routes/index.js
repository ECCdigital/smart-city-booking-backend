const express = require("express");
const router = express.Router({ mergeParams: true });

// Before the tenant routes: `instance` is the scope segment of the instance
// media library (§4.9), `dashboard` the cross-tenant dashboard and
// `favorites` the favorites list of the signed-in user across tenants, so
// none must be read as a tenant id.
router.use("/instance/media", require("./instance.media.routes"));
router.use("/dashboard", require("./dashboard.routes"));
router.use("/favorites", require("./favorite.routes"));

router.use("/:tenant/checkout", require("./tenant.checkout.routes"));
router.use("/:tenant/coupon", require("./tenant.coupon.routes"));
router.use("/:tenant/bookings", require("./tenant.booking-status.routes"));
router.use("/:tenant/media", require("./tenant.media.routes"));
router.use("/:tenant/dashboard", require("./tenant.dashboard.routes"));
router.use("/:tenant/favorites", require("./tenant.favorite.routes"));

module.exports = router;
