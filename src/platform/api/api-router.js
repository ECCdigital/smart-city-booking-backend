var express = require("express");
const AuthenticationController = require("../authentication/controllers/authentication-controller");
const TenantController = require("./controllers/tenant-controller");
const InstanceController = require("./controllers/instance-controller");
const UserController = require("./controllers/user-controller");

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

// USERS
// =====

// Protected
router.get(
  "/users",
  AuthenticationController.isSignedIn,
  UserController.getUsers,
);
router.get(
  "/users/ids",
  AuthenticationController.isSignedIn,
  UserController.getUserIds,
);
router.get(
  "/users/:id",
  AuthenticationController.isSignedIn,
  UserController.getUser,
);
router.put(
  "/users",
  AuthenticationController.isSignedIn,
  UserController.storeUser,
);
router.put(
  "/user",
  AuthenticationController.isSignedIn,
  UserController.updateMe,
);
router.delete(
  "/users/:id",
  AuthenticationController.isSignedIn,
  UserController.removeUser,
);

module.exports = router;
