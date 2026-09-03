const { asyncRouter } = require("../../../middleware/async-router");
const InstanceController = require("../controllers/instance-controller");
const {
  authorize,
  publicRoute,
} = require("../../../commons/services/authorization");

const router = asyncRouter();

router.get(
  "/public",
  publicRoute("instance", "readPublic"),
  InstanceController.getPublicInstance,
);

router.get(
  "/bookable-custom-fields",
  publicRoute("instance", "readPublic"),
  InstanceController.getBookableCustomFields,
);

router.get("/", authorize("instance", "read"), InstanceController.getInstance);
router.put(
  "/",
  authorize("instance", "update"),
  InstanceController.storeInstance,
);

module.exports = router;
