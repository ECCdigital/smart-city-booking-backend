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

// Naming the bookings of an access point names their customers, so the reach
// is the booking reader's (`accessPoint.bookings`) and not the one that
// carries the access point list.
router.get(
  "/:id/bookings",
  authorize("accessPoint", "bookings"),
  AccessPointController.getAccessPointBookings,
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
