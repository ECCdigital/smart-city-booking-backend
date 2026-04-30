const express = require("express");
const router = express.Router({ mergeParams: true });



router.use("/:tenant/checkout", require("./tenant.checkout.routes"));

module.exports = router;
