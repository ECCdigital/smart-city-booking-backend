const { asyncRouter } = require("../../../middleware/async-router");
const AuthenticationController = require("../../authentication/controllers/authentication-controller");
const InstanceController = require("../controllers/instance-controller");

const router = asyncRouter();

router.get("/public", InstanceController.getPublicInstance);

router.get(
  "/bookable-custom-fields",
  InstanceController.getBookableCustomFields,
);

router.get(
  "/",
  AuthenticationController.isSignedIn,
  InstanceController.getInstance,
);
router.put(
  "/",
  AuthenticationController.isSignedIn,
  InstanceController.storeInstance,
);

module.exports = router;
