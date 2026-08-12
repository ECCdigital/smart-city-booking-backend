const express = require("express");
const router = express.Router({ mergeParams: true });
const AuthenticationController = require("../../authentication/controllers/authentication-controller");
const AccessPointController = require("../controllers/access-point-controller");

router.get(
  "/",
  AuthenticationController.isSignedIn,
  AccessPointController.getAccessPoints,
);

router.put(
  "/",
  AuthenticationController.isSignedIn,
  AccessPointController.storeAccessPoint,
);

router.get(
  "/:id",
  AuthenticationController.isSignedIn,
  AccessPointController.getAccessPoint,
);

router.get(
  "/:id/qrcode",
  AuthenticationController.isSignedIn,
  AccessPointController.getQrCode,
);

router.get(
  "/:id/location-prefill",
  AuthenticationController.isSignedIn,
  AccessPointController.getLocationPrefill,
);

router.post(
  "/:id/rotate-scan-code",
  AuthenticationController.isSignedIn,
  AccessPointController.rotateScanCode,
);

router.delete(
  "/:id",
  AuthenticationController.isSignedIn,
  AccessPointController.removeAccessPoint,
);

module.exports = router;
