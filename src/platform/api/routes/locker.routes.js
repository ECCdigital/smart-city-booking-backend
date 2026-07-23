const express = require("express");
const router = express.Router({ mergeParams: true });
const AuthenticationController = require("../../authentication/controllers/authentication-controller");
const LockerController = require("../controllers/locker-controller");

router.get(
  "/:provider/locations",
  AuthenticationController.isSignedIn,
  LockerController.getLocations,
);

router.get(
  "/:provider/locations/:locationId",
  AuthenticationController.isSignedIn,
  LockerController.getLocationById,
);

router.get(
  "/:provider/locations/:locationId/status",
  AuthenticationController.isSignedIn,
  LockerController.getLocationsStat,
);

router.get(
  "/:provider/locations/:locationId/price",
  AuthenticationController.isSignedIn,
  LockerController.getPrice,
);

router.post(
  "/:provider/test",
  AuthenticationController.isSignedIn,
  LockerController.testConnection,
);

router.get(
  "/:provider/customer-service-info",
  LockerController.getCustomerServiceInfo,
);

module.exports = router;
