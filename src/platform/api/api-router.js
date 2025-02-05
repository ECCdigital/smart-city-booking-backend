var express = require("express");
const AuthenticationController = require("../authentication/controllers/authentication-controller");
const TenantController = require("./controllers/tenant-controller");
const InstanceController = require("./controllers/instance-controller");

var router = express.Router({ mergeParams: true });

// INSTANCES
// =========

// Public
router.get("/instances/public", InstanceController.getPublicInstance);

// Protected
router.get(
  "/instances",
  AuthenticationController.isSignedIn,
  InstanceController.getInstance,
);
router.put(
  "/instances",
  AuthenticationController.isSignedIn,
  InstanceController.storeInstance,
);

// TENANTS
// =======

// Public
router.get(
  "/tenants",
  AuthenticationController.isSignedIn,
  TenantController.getTenants,
);
router.get(
  "/tenants/:id",
  AuthenticationController.isSignedIn,
  TenantController.getTenant,
);
router.get("/tenants/:id/payment-apps", TenantController.getActivePaymentApps);

// Protected
router.put(
  "/tenants",
  AuthenticationController.isSignedIn,
  TenantController.storeTenant,
);
router.delete(
  "/tenants/:id",
  AuthenticationController.isSignedIn,
  TenantController.removeTenant,
);
router.get(
  "/tenants/count/check",
  AuthenticationController.isSignedIn,
  TenantController.countCheck,
);

module.exports = router;
