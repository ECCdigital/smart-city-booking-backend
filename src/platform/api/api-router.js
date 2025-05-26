const express = require("express");
const AuthenticationController = require("../authentication/controllers/authentication-controller");
const { TenantController } = require("./controllers/tenant-controller");
const InstanceController = require("./controllers/instance-controller");
const UserController = require("./controllers/user-controller");
const RoleController = require("./controllers/role-controller");
const HolidayController = require("./controllers/holiday-controller");

const router = express.Router({ mergeParams: true });

// INSTANCES
// =========

// Protected
router.get("/instances", InstanceController.getInstance);
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
router.post(
  "/tenants",
  AuthenticationController.isSignedIn,
  TenantController.createTenant,
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

router.post(
  "/tenants/:id/add-user",
  AuthenticationController.isSignedIn,
  TenantController.addUser,
);

router.post(
  "/tenants/:id/remove-user",
  AuthenticationController.isSignedIn,
  TenantController.removeUser,
);

router.post(
  "/tenants/:id/edit-user-roles",
  AuthenticationController.isSignedIn,
  TenantController.editUserRole,
);

router.post(
  "/tenants/:id/add-owner",
  AuthenticationController.isSignedIn,
  TenantController.addOwner,
);

router.post(
  "/tenants/:id/remove-owner",
  AuthenticationController.isSignedIn,
  TenantController.removeOwner,
);

router.get(
  "/tenants/:id/users",
  AuthenticationController.isSignedIn,
  TenantController.getUsers,
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

router.get(
  "/roles",
  AuthenticationController.isSignedIn,
  RoleController.getRoles,
);

router.get("/holidays", HolidayController.getHolidays);

module.exports = router;
