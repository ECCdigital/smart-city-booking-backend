const express = require("express");
const router = express.Router({ mergeParams: true });
const { authorize } = require("../../../commons/services/authorization");
const AccessPointController = require("../controllers/access-point-controller");

router.get(
  "/",
  authorize("accessPoint", "read"),
  AccessPointController.getAccessPoints,
);

router.put(
  "/",
  authorize("accessPoint", "write"),
  AccessPointController.storeAccessPoint,
);

router.get(
  "/:id",
  authorize("accessPoint", "read"),
  AccessPointController.getAccessPoint,
);

router.get(
  "/:id/qrcode",
  authorize("accessPoint", "write"),
  AccessPointController.getQrCode,
);

router.get(
  "/:id/location-prefill",
  authorize("accessPoint", "write"),
  AccessPointController.getLocationPrefill,
);

router.post(
  "/:id/rotate-scan-code",
  authorize("accessPoint", "write"),
  AccessPointController.rotateScanCode,
);

router.delete(
  "/:id",
  authorize("accessPoint", "write"),
  AccessPointController.removeAccessPoint,
);

module.exports = router;
