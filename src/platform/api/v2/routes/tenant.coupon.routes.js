const { asyncRouter } = require("../../../../middleware/async-router");
const CouponControllerV2 = require("../controllers/coupon.controller");

const router = asyncRouter();

router.get("/validate/:id", CouponControllerV2.validateCoupon);

module.exports = router;
