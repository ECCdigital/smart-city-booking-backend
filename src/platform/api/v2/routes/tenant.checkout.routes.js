const { asyncRouter } = require("../../../../middleware/async-router");
const CheckoutControllerV2 = require("../controllers/checkout.controller");
const { publicRoute } = require("../../../../commons/services/authorization");

const router = asyncRouter();

router.post(
  "/validate-group",
  publicRoute("checkout", "all"),
  CheckoutControllerV2.validateGroup,
);
router.post(
  "/validate/:id",
  publicRoute("checkout", "all"),
  CheckoutControllerV2.validateItem,
);
router.post("/", publicRoute("checkout", "all"), CheckoutControllerV2.checkout);
router.post(
  "/group",
  publicRoute("checkout", "all"),
  CheckoutControllerV2.groupCheckout,
);
router.get(
  "/permissions/:id",
  publicRoute("checkout", "all"),
  CheckoutControllerV2.checkoutPermissions,
);

module.exports = router;
