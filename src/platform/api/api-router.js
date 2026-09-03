const express = require("express");
const { TenantController } = require("./controllers/tenant-controller");
const UserController = require("./controllers/user-controller");
const RoleController = require("./controllers/role-controller");
const HolidayController = require("./controllers/holiday-controller");
const InvitationController = require("./controllers/invitation-controller");
const MembershipController = require("./controllers/membership-controller");
const CatalogController = require("./controllers/catalog-controller");
const RuleController = require("./controllers/rule-controller");
const FileController = require("./controllers/file-controller");
const MailTemplateController = require("./controllers/mail-template-controller");
const { BookingController } = require("./controllers/booking-controller");
const AccessController = require("./controllers/access-controller");
const InstanceController = require("./controllers/instance-controller");
const {
  authorize,
  publicRoute,
} = require("../../commons/services/authorization");

const router = express.Router({ mergeParams: true });

// The instance level (authorize spec §3.2): every route carries its marker.
// A route about one tenant names it `:tenant`, as the tenant router does,
// so the principal is loaded in that tenant; `PUT /tenants` names it in the
// body.

// ACCESS WEBHOOKS
// ===============

router.use("/webhooks/access", require("./routes/access-webhook.routes"));

// INSTANCES
// =========

router.get(
  "/instances/public",
  publicRoute("instance", "readPublic"),
  InstanceController.getPublicInstance,
);
router.get(
  "/instances",
  authorize("instance", "read"),
  InstanceController.getInstance,
);
router.put(
  "/instances",
  authorize("instance", "update"),
  InstanceController.storeInstance,
);

// RULES
// =====

router.get(
  "/rules/meta",
  authorize("rule", "read"),
  RuleController.getMetadata,
);
router.get(
  "/rules/executions",
  authorize("rule", "read"),
  RuleController.getExecutionLogs,
);
router.get("/rules", authorize("rule", "read"), RuleController.getRules);
router.post("/rules", authorize("rule", "write"), RuleController.createRule);
router.get("/rules/:id", authorize("rule", "read"), RuleController.getRule);
router.put("/rules/:id", authorize("rule", "write"), RuleController.updateRule);
router.put(
  "/rules/:id/enabled",
  authorize("rule", "write"),
  RuleController.setRuleEnabled,
);
router.delete(
  "/rules/:id",
  authorize("rule", "write"),
  RuleController.deleteRule,
);
router.post("/rules/:id/run", authorize("rule", "run"), RuleController.runRule);
router.post(
  "/rules/:id/dry-run",
  authorize("rule", "run"),
  RuleController.dryRunRule,
);
router.get(
  "/rules/:id/executions",
  authorize("rule", "read"),
  RuleController.getRuleExecutionLogs,
);

// TENANTS
// =======

router.get(
  "/tenants/public",
  publicRoute("tenant", "listPublic"),
  TenantController.getPublicTenants,
);
router.get(
  "/tenants/count/check",
  authorize("tenant", "countCheck"),
  TenantController.countCheck,
);
router.get(
  "/tenants",
  authorize("tenant", "list"),
  TenantController.getTenants,
);
router.post(
  "/tenants",
  authorize("tenant", "create"),
  TenantController.createTenant,
);
// The obsolete store: the tenant is the body's; an unknown id creates,
// which is the adapter's second decision (§12).
router.put(
  "/tenants",
  authorize("tenant", "update", { tenantOf: (req) => req.body?.id }),
  TenantController.storeTenant,
);
router.get(
  "/tenants/:tenant",
  authorize("tenant", "read"),
  TenantController.getTenant,
);
router.delete(
  "/tenants/:tenant",
  authorize("tenant", "delete"),
  TenantController.removeTenant,
);
router.get(
  "/tenants/:tenant/payment-apps",
  publicRoute("tenant", "paymentApps"),
  TenantController.getActivePaymentApps,
);
router.get(
  "/tenants/:tenant/mail/templates/default",
  authorize("tenant", "mailTemplates"),
  MailTemplateController.getDefaultTemplates,
);
router.post(
  "/tenants/:tenant/pdf-preview",
  authorize("tenant", "pdfPreview"),
  TenantController.previewPdfTemplate,
);

router.get(
  "/tenants/:tenant/users",
  authorize("tenantUser", "read"),
  TenantController.getUsers,
);
router.post(
  "/tenants/:tenant/add-user",
  authorize("tenantUser", "manage"),
  TenantController.addUser,
);
router.post(
  "/tenants/:tenant/remove-user",
  authorize("tenantUser", "manage"),
  TenantController.removeUser,
);
router.post(
  "/tenants/:tenant/edit-user-roles",
  authorize("tenantUser", "manage"),
  TenantController.editUserRole,
);
router.post(
  "/tenants/:tenant/remove-user-role",
  authorize("tenantUser", "manage"),
  TenantController.removeUserRole,
);
router.post(
  "/tenants/:tenant/update-user-status",
  authorize("tenantUser", "manage"),
  TenantController.updateUserStatus,
);
router.post(
  "/tenants/:tenant/update-user-booking-notification-recipients",
  authorize("tenantUser", "manage"),
  TenantController.updateUserBookingNotificationRecipients,
);
router.post(
  "/tenants/:tenant/add-owner",
  authorize("tenantUser", "owner"),
  TenantController.addOwner,
);
router.post(
  "/tenants/:tenant/remove-owner",
  authorize("tenantUser", "owner"),
  TenantController.removeOwner,
);

// USERS
// =====

router.get("/users", authorize("user", "read"), UserController.getUsers);
router.get("/users/ids", authorize("user", "read"), UserController.getUserIds);
router.get("/users/:id", authorize("user", "read"), UserController.getUser);
router.post(
  "/users/:id/change-id",
  authorize("user", "changeId"),
  UserController.changeUserId,
);
// The obsolete store: an unknown id creates, the adapter's second decision.
router.put("/users", authorize("user", "update"), UserController.storeUser);
router.put("/user", authorize("user", "updateSelf"), UserController.updateMe);
router.delete(
  "/users/:id",
  authorize("user", "delete"),
  UserController.removeUser,
);

// ROLES, HOLIDAYS
// ===============

router.get("/roles", authorize("role", "list"), RoleController.getRoles);

router.get(
  "/holidays",
  publicRoute("holidays", "all"),
  HolidayController.getHolidays,
);

// INVITATIONS
// ===========

router.get(
  "/invitations/my",
  authorize("invitation", "readMine"),
  InvitationController.getMyInvitations,
);

// MEMBERSHIPS
// ===========

router.get(
  "/memberships",
  authorize("membership", "read"),
  MembershipController.getMemberships,
);
router.get(
  "/memberships/my/pending",
  authorize("membership", "readMine"),
  MembershipController.getMyPendingMemberships,
);
router.get(
  "/memberships/my",
  authorize("membership", "readMine"),
  MembershipController.getMyMemberships,
);

// CATALOG
// =======

router.get(
  "/catalog",
  authorize("instanceCatalog", "read"),
  CatalogController.getInstanceCatalog,
);
router.get(
  "/catalog/public",
  publicRoute("instanceCatalog", "readPublic"),
  CatalogController.getPublicCatalog,
);
router.get(
  "/catalog/mode",
  publicRoute("instanceCatalog", "mode"),
  CatalogController.getPortalMode,
);
router.get(
  "/catalog/bundle",
  publicRoute("instanceCatalog", "readPublic"),
  CatalogController.getCatalogBundle,
);
router.put(
  "/catalog",
  authorize("instanceCatalog", "store"),
  CatalogController.storeInstanceCatalog,
);
router.get(
  "/catalog/themes/:slug",
  publicRoute("instanceCatalog", "themes"),
  CatalogController.getTheme,
);
router.get(
  "/catalog/themes",
  publicRoute("instanceCatalog", "themes"),
  CatalogController.getTheme,
);
router.get(
  "/catalog/availability/:slug",
  authorize("instanceCatalog", "slugAvailability"),
  CatalogController.slugAvailability,
);
router.get(
  "/catalog/:slug",
  publicRoute("instanceCatalog", "readPublic"),
  CatalogController.getCatalogBySlug,
);

// FILES
// =====

// The tenant-less listing and upload are gone with the instance media library
// (§4.9) — `/api/v2/instance/media` replaces them. `GET /files/get` stays as
// the resolver of legacy paths (§4.10): a public medium for anyone, an intern
// one for a signed-in user - the medium's visibility decides in the media
// module, in addition to the reach.
router.get(
  "/files/get",
  publicRoute("instanceMedia", "file"),
  FileController.getFile,
);

// BOOKINGS
// ========

router.get(
  "/bookings/assigned",
  authorize("booking", "read"),
  BookingController.getAssignedBookings,
);

// ACCESS (tenant-independent: a user may have bookings across tenants)
// ===================================================================

router.get(
  "/access/bookings",
  authorize("accessBookings", "read"),
  AccessController.getAccessBookings,
);
router.get(
  "/access/access-points/:accessPointId/bookings",
  authorize("accessBookings", "read"),
  AccessController.getAccessPointBookings,
);

router.use("/instances", require("./routes/instance.routes"));

module.exports = router;
