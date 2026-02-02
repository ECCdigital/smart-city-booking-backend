const express = require("express");
const AuthenticationController = require("../authentication/controllers/authentication-controller");
const { TenantController } = require("./controllers/tenant-controller");
const InstanceController = require("./controllers/instance-controller");
const UserController = require("./controllers/user-controller");
const RoleController = require("./controllers/role-controller");
const HolidayController = require("./controllers/holiday-controller");
const InvitationController = require("./controllers/invitation-controller");
const MembershipController = require("./controllers/membership-controller");
const CatalogController = require("./controllers/catalog-controller");
const FileController = require("./controllers/file-controller");
const { BookingController } = require("./controllers/booking-controller");

const router = express.Router({ mergeParams: true });

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
router.get("/tenants/public", TenantController.getPublicTenants);
router.get(
  "/tenants/:id",
  AuthenticationController.isSignedIn,
  TenantController.getTenant,
);
router.get("/tenants/:id/payment-apps", TenantController.getActivePaymentApps);

// Protected
router.get(
  "/tenants",
  AuthenticationController.isSignedIn,
  TenantController.getTenants,
);
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

router.post(
  "/tenants/:id/remove-user-role",
  AuthenticationController.isSignedIn,
  TenantController.removeUserRole,
);

router.get(
  "/tenants/:id/users",
  AuthenticationController.isSignedIn,
  TenantController.getUsers,
);

router.post(
  "/tenants/:id/update-user-status",
  AuthenticationController.isSignedIn,
  TenantController.updateUserStatus,
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

//INVITATIONS
router.get(
  "/invitations/my",
  AuthenticationController.isSignedIn,
  InvitationController.getMyInvitations,
);

// MEMBERSHIPS
// ===========
router.get(
  "/memberships",
  AuthenticationController.isSignedIn,
  MembershipController.getMemberships,
);

router.get(
  "/memberships/my/pending",
  AuthenticationController.isSignedIn,
  MembershipController.getMyPendingMemberships,
);
// Catalog
router.get(
  "/catalog",
  AuthenticationController.isSignedIn,
  CatalogController.getInstanceCatalog,
);
router.get("/catalog/public", CatalogController.getPublicCatalog);
router.get("/catalog/bundle", CatalogController.getCatalogBundle);

router.put(
  "/catalog",
  AuthenticationController.isSignedIn,
  CatalogController.storeInstanceCatalog,
);

router.get("/catalog/themes/:slug", CatalogController.getTheme);
router.get("/catalog/themes", CatalogController.getTheme);
router.get(
  "/catalog/availability/:slug",
  AuthenticationController.isSignedIn,
  CatalogController.slugAvailability,
);
router.get("/catalog/:slug", CatalogController.getCatalogBySlug);

router.get("/files/list", FileController.getFiles);
router.get("/files/get", FileController.getFile);
router.post(
  "/files",
  AuthenticationController.isSignedIn,
  FileController.createFile,
);

//Bookings
router.get(
  "/bookings/assigned",
  AuthenticationController.isSignedIn,
  BookingController.getAssignedBookings,
);

module.exports = router;
