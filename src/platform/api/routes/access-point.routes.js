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

// The bookings at Fächer of a Schließfachanlage, read before they go out of
// service or out of the Anlage (tickets#1043): naming them names their
// customers, so the reach is the booking reader's, as above.
router.get(
  "/:id/compartment-bookings",
  authorize("accessPoint", "bookings"),
  AccessPointController.getCompartmentBookings,
);

router.get(
  "/:id/qrcode",
  authorize("accessPoint", "write"),
  AccessPointController.getQrCode,
);

// The QR code of one Fach of a Schließfachanlage (tickets#1056), with the
// door's right: printing a sticker is writing the access point.
router.get(
  "/:id/compartments/:compartmentId/qrcode",
  authorize("accessPoint", "write"),
  AccessPointController.getCompartmentQrCode,
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
