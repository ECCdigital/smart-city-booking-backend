const { asyncRouter } = require("../../../../middleware/async-router");
const CheckoutControllerV2 = require("../controllers/checkout.controller");

const router = asyncRouter();

router.post("/validate/:id", CheckoutControllerV2.validateItem);
router.post("/checkout", CheckoutControllerV2.checkout);
router.post("/group-checkout", CheckoutControllerV2.groupCheckout);
router.get(
  "/permissions/:id",
  CheckoutControllerV2.checkoutPermissions,
);

module.exports = router;
