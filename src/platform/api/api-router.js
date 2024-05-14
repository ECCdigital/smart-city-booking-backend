var express = require("express");
const AuthenticationController = require("../authentication/controllers/authentication-controller");
const TenantController = require("./controllers/tenant-controller");
const RoleController = require("./controllers/role-controller");

var router = express.Router({ mergeParams: true });


// TENANTS
// =======

// Public
router.get("/tenants", TenantController.getTenants);
router.get("/tenants/:id", TenantController.getTenant);
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

// ROLES
// =====

// Protected
router.get(
  "/roles",
  AuthenticationController.isSignedIn,
  RoleController.getRoles,
);
router.put(
  "/roles",
  AuthenticationController.isSignedIn,
  RoleController.storeRole,
);
router.get(
  "/roles/:id",
  AuthenticationController.isSignedIn,
  RoleController.getRole,
);
router.delete(
  "/roles/:id",
  AuthenticationController.isSignedIn,
  RoleController.removeRole,
);

module.exports = router;
