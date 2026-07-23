const { asyncRouter } = require("../../../../middleware/async-router");
const CheckoutControllerV2 = require("../controllers/checkout.controller");
const { optionalAuth } = require("../../../../middleware/auth-middleware");

const router = asyncRouter();

router.post(
  "/validate-group",
  optionalAuth,
  CheckoutControllerV2.validateGroup,
);
router.post("/validate/:id", optionalAuth, CheckoutControllerV2.validateItem);
router.post("/", optionalAuth, CheckoutControllerV2.checkout);
router.post("/group", optionalAuth, CheckoutControllerV2.groupCheckout);
router.get(
  "/permissions/:id",
  optionalAuth,
  CheckoutControllerV2.checkoutPermissions,
);

module.exports = router;
