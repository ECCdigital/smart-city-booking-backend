const { asyncRouter } = require("../../../../middleware/async-router");
const CheckoutControllerV2 = require("../controllers/checkout.controller");
const { publicRoute } = require("../../../../commons/services/authorization");
const { acceptCheckoutFiles } = require("../../../../middleware/file-upload");

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
// JSON, or multipart with the customer uploads of the checkout.
router.post(
  "/",
  publicRoute("checkout", "all"),
  acceptCheckoutFiles(),
  CheckoutControllerV2.checkout,
);
// JSON, or multipart with the customer uploads of the group.
router.post(
  "/group",
  publicRoute("checkout", "all"),
  acceptCheckoutFiles(),
  CheckoutControllerV2.groupCheckout,
);
router.get(
  "/permissions/:id",
  publicRoute("checkout", "all"),
  CheckoutControllerV2.checkoutPermissions,
);

module.exports = router;
