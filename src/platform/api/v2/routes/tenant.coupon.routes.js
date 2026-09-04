const { asyncRouter } = require("../../../../middleware/async-router");
const CouponControllerV2 = require("../controllers/coupon.controller");
const { publicRoute } = require("../../../../commons/services/authorization");

const router = asyncRouter();

// Redeeming a coupon is the customer's lookup, as at `GET /:tenant/coupons/:id`.
router.get(
  "/validate/:id",
  publicRoute("coupon", "lookup"),
  CouponControllerV2.validateCoupon,
);

module.exports = router;
