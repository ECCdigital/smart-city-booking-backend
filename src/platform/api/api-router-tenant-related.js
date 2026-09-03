/**
 * The tenant router, `/api/:tenant`. Every route carries one marker of the
 * authorization (glossary "Berechtigung", spec §2.4): `authorize(resource,
 * action)` decides over the rights table and hands the reach (glossary
 * "Reichweite") to the handler as `req.reach`, `public(resource, action)`
 * decides for the anonymous too and never refuses, `public()` is a plainly
 * public route, `tokenAuthorized()` marks a route that authorizes over a
 * secret in URL or body. No handler of this router branches over rights.
 */

const express = require("express");
const BookableController = require("./controllers/bookable-controller");
const EventController = require("./controllers/event-controller");
const PaymentController = require("./controllers/payment-controller");
const CalendarController = require("./controllers/calendar-controller");
const CouponController = require("./controllers/coupon-controller");
const { BookingController } = require("./controllers/booking-controller");
const CheckoutController = require("./controllers/checkout-controller");
const FileController = require("./controllers/file-controller");
const WorkflowController = require("./controllers/workflow-controller");
const InvitationController = require("./controllers/invitation-controller");
const RoleController = require("./controllers/role-controller");
const { TenantController } = require("./controllers/tenant-controller");
const {
  GroupBookingController,
} = require("./controllers/group-booking-controller");
const {
  authorize,
  publicRoute,
  tokenAuthorized,
} = require("../../commons/services/authorization");

const router = express.Router({ mergeParams: true });

// BOOKABLES
// =========

// Public
router.get(
  "/bookables/public",
  publicRoute("bookable", "readPublic"),
  BookableController.getPublicBookables,
);
router.get(
  "/bookables/public/:id",
  publicRoute("bookable", "readPublic"),
  BookableController.getPublicBookable,
);
router.get(
  "/bookables/:id/bookings",
  publicRoute("bookable", "relatedBookings"),
  BookingController.getRelatedBookings,
);
router.get(
  "/bookables/:id/openingHours",
  publicRoute("bookable", "readPublic"),
  BookableController.getOpeningHours,
);
router.get(
  "/bookables/:id/availability/v1",
  publicRoute(),
  CalendarController.getBookableAvailabilityV1,
);
router.get(
  "/bookables/:id/availability/v2",
  publicRoute(),
  CalendarController.getBookableAvailabilityV2,
);
router.get(
  "/bookables/:id/availability",
  publicRoute(),
  CalendarController.getBookableAvailability,
);
router.get(
  "/bookables/:id/block-periods",
  publicRoute(),
  CalendarController.getBookableBlockPeriods,
);
router.get(
  "/bookables/:id/occupancy",
  publicRoute("bookable", "readPublic"),
  BookableController.getBookableOccupancy,
);
router.get(
  "/bookables/:id/prices",
  publicRoute("bookable", "readPublic"),
  BookableController.getBookablePriceCategories,
);

// Protected
router.get(
  "/bookables",
  authorize("bookable", "read"),
  BookableController.getBookables,
);
router.get(
  "/bookables/_template",
  authorize("bookable", "template"),
  BookableController.getBookableTemplate,
);
router.get(
  "/bookables/:id",
  authorize("bookable", "read"),
  BookableController.getBookable,
);
// The obsolete store: an update, or a creation the handler decides (§11).
router.put(
  "/bookables",
  authorize("bookable", "update"),
  BookableController.storeBookable,
);
router.delete(
  "/bookables/:id",
  authorize("bookable", "delete"),
  BookableController.removeBookable,
);
router.get(
  "/bookables/_meta/tags",
  authorize("bookable", "meta"),
  BookableController.getTags,
);
router.get(
  "/bookables/count/check",
  authorize("bookable", "meta"),
  BookableController.countCheck,
);

// EVENTS
// ======

// Public
router.get("/events", publicRoute("event", "read"), EventController.getEvents);
router.get(
  "/events/:id",
  publicRoute("event", "read"),
  EventController.getEvent,
);
router.get(
  "/events/:id/bookings",
  publicRoute("booking", "list"),
  BookingController.getEventBookings,
);

// Protected
router.put("/events", authorize("event", "update"), EventController.storeEvent);
router.delete(
  "/events/:id",
  authorize("event", "delete"),
  EventController.removeEvent,
);
router.get(
  "/events/_meta/tags",
  authorize("event", "meta"),
  EventController.getTags,
);
router.get(
  "/events/count/check",
  authorize("event", "meta"),
  EventController.countCheck,
);
router.get(
  "/events/:id/count",
  authorize("event", "seatCount"),
  EventController.getBookedSeatsCount,
);

// BOOKINGS
// ========

router.get(
  "/bookings",
  publicRoute("booking", "list"),
  BookingController.getBookings,
);
router.put(
  "/bookings",
  authorize("booking", "update"),
  BookingController.storeBooking,
);
router.get(
  "/bookings/assigned",
  authorize("booking", "read"),
  BookingController.getAssignedBookings,
);
router.get(
  "/bookings/:id",
  authorize("booking", "read"),
  BookingController.getBooking,
);
router.delete(
  "/bookings/:id",
  authorize("booking", "delete"),
  BookingController.removeBooking,
);
router.get(
  "/bookings/:ids/status",
  publicRoute("booking", "lookup"),
  BookingController.getBookingStatus,
);
router.get(
  "/bookings/:id/status/public",
  publicRoute("booking", "lookup"),
  BookingController.getPublicBookingStatus,
);
router.get(
  "/bookings/:id/commit",
  authorize("booking", "commit"),
  BookingController.commitBooking,
);
router.post(
  "/bookings/:id/pay",
  authorize("booking", "pay"),
  BookingController.payBooking,
);
router.get(
  "/bookings/:id/cancellation-refund-preview",
  authorize("booking", "cancel"),
  BookingController.getCancellationRefundPreview,
);
router.get(
  "/bookings/:id/cancellation-refund-preview/public",
  publicRoute("booking", "lookup"),
  BookingController.getPublicCancellationRefundPreview,
);
router.post(
  "/bookings/:id/reject",
  authorize("booking", "reject"),
  BookingController.rejectBooking,
);
router.post(
  "/bookings/:id/request-reject",
  tokenAuthorized(),
  BookingController.requestRejectBooking,
);
router.get(
  "/bookings/:id/verify-ownership",
  tokenAuthorized(),
  BookingController.verifyBookingOwnership,
);
router.get(
  "/bookings/:id/hooks/:hookId/cancellation-refund-preview",
  tokenAuthorized(),
  BookingController.getHookCancellationRefundPreview,
);
router.get(
  "/bookings/:id/hooks/:hookId/release",
  tokenAuthorized(),
  BookingController.releaseBookingHook,
);
router.post(
  "/bookings/:id/receipt",
  authorize("booking", "reprint"),
  BookingController.createReceipt,
);
router.get(
  "/bookings/:id/receipt/:receiptId",
  authorize("booking", "document"),
  BookingController.getReceipt,
);
router.get(
  "/bookings/:id/invoice/:invoiceId",
  authorize("booking", "document"),
  BookingController.getInvoice,
);
router.post(
  "/bookings/:id/invoice",
  authorize("booking", "invoice"),
  BookingController.createInvoice,
);
router.post(
  "/bookings/:id/cancellation-receipt",
  authorize("booking", "reprint"),
  BookingController.createCancellationReceipt,
);
router.get(
  "/bookings/:id/cancellation-receipt/:cancellationReceiptId",
  authorize("booking", "document"),
  BookingController.getCancellationReceipt,
);

// USERS
// =====
router.get(
  "/users",
  authorize("tenantUser", "read"),
  TenantController.getUsers,
);

// GROUP BOOKINGS
// ==============
router.get(
  "/group-bookings",
  authorize("groupBooking", "read"),
  GroupBookingController.getGroupBookings,
);
router.get(
  "/group-bookings/:id",
  authorize("groupBooking", "read"),
  GroupBookingController.getGroupBooking,
);
router.put(
  "/group-bookings/:id",
  authorize("groupBooking", "update"),
  GroupBookingController.updateGroupBooking,
);
router.post(
  "/group-bookings/:id/commit",
  authorize("groupBooking", "commit"),
  GroupBookingController.commitGroupBooking,
);
router.post(
  "/group-bookings/:id/pay",
  authorize("groupBooking", "pay"),
  GroupBookingController.payGroupBooking,
);
// The preview belongs to the administration's cancellation of the group.
router.get(
  "/group-bookings/:id/cancellation-refund-preview",
  authorize("groupBooking", "reject"),
  GroupBookingController.getCancellationRefundPreview,
);
router.post(
  "/group-bookings/:id/reject",
  authorize("groupBooking", "reject"),
  GroupBookingController.rejectGroupBooking,
);
router.get(
  "/group-bookings/booking/:bookingId",
  authorize("groupBooking", "read"),
  GroupBookingController.getGroupBookingByBookingId,
);
router.delete(
  "/group-bookings/:id",
  authorize("groupBooking", "delete"),
  GroupBookingController.removeGroupBooking,
);
router.post(
  "/group-bookings/:id/receipt",
  authorize("groupBooking", "document"),
  GroupBookingController.createGroupBookingReceipt,
);
router.post(
  "/group-bookings/:id/invoice",
  authorize("groupBooking", "invoice"),
  GroupBookingController.createGroupBookingInvoice,
);
router.post(
  "/group-bookings/:id/cancellation-receipt",
  authorize("groupBooking", "document"),
  GroupBookingController.createGroupBookingCancellationReceipt,
);

// CHECKOUT
// ========
router.post("/checkout", publicRoute(), CheckoutController.checkout);
router.post("/checkout/group", publicRoute(), CheckoutController.groupCheckout);
router.post(
  "/checkout/validateItem",
  publicRoute(),
  CheckoutController.validateItem,
);
router.get(
  "/checkout/permissions/:id",
  publicRoute(),
  CheckoutController.checkoutPermissions,
);

// PAYMENTS
// ========

// Public
router.post("/payments", publicRoute(), PaymentController.createPayment);
// The provider's webhooks and return pages authorize over the payment's
// own reference; the handler checks it as today.
router.get(
  "/payments/notify",
  tokenAuthorized(),
  PaymentController.paymentNotificationGET,
);
router.post(
  "/payments/notify",
  tokenAuthorized(),
  PaymentController.paymentNotificationPOST,
);
router.post(
  "/payments/response",
  tokenAuthorized(),
  PaymentController.paymentResponse,
);
router.get(
  "/payments/response",
  tokenAuthorized(),
  PaymentController.paymentResponse,
);
router.get(
  "/payments/providers/:provider/test",
  authorize("tenant", "paymentTest"),
  PaymentController.testConnection,
);

// CALENDAR
// ========
router.get(
  "/calendar/occupancy",
  publicRoute(),
  CalendarController.getOccupancies,
);

// COUPONS
// =======
router.get(
  "/coupons",
  authorize("coupon", "read"),
  CouponController.getCoupons,
);
router.get(
  "/coupons/:id",
  publicRoute("coupon", "lookup"),
  CouponController.getCoupon,
);
// The obsolete store: an update, or a creation the handler decides (§11).
router.put(
  "/coupons",
  authorize("coupon", "update"),
  CouponController.storeCoupon,
);
router.delete(
  "/coupons/:id",
  authorize("coupon", "delete"),
  CouponController.deleteCoupon,
);

// LEGACY FILES
// ============
// The tenant listing and upload are gone with the media library — the admin UI
// picks and uploads media (§4.10). `GET /files/get` stays for good as the
// resolver of stored legacy addresses; the medium's visibility is the media
// module's (authorize spec §5), decided in the handler.
router.get("/files/get", publicRoute(), FileController.getTenantFile);

// WORKFLOW
// ========
// Protected
router.get(
  "/workflow/",
  authorize("workflow", "read"),
  WorkflowController.getWorkflow,
);
router.post(
  "/workflow/",
  authorize("workflow", "manage"),
  WorkflowController.createWorkflow,
);
router.put(
  "/workflow/",
  authorize("workflow", "manage"),
  WorkflowController.updateWorkflow,
);
router.get(
  "/workflow/states",
  authorize("workflow", "read"),
  WorkflowController.getWorkflowStates,
);
router.put(
  "/workflow/task",
  authorize("workflow", "task"),
  WorkflowController.updateTask,
);
router.put(
  "/workflow/archive",
  authorize("workflow", "task"),
  WorkflowController.archiveTask,
);
router.get(
  "/workflow/backlog",
  authorize("workflow", "read"),
  WorkflowController.getBacklog,
);

// ROLES
// =====

// Protected
router.get("/roles", authorize("role", "list"), RoleController.getRoles);
router.get(
  "/roles/tenant",
  authorize("role", "readMine"),
  RoleController.getUserRolesByTenant,
);
// The obsolete store: an update, or a creation the handler decides (§11).
router.put("/roles", authorize("role", "update"), RoleController.storeRole);
router.get("/roles/:id", authorize("role", "read"), RoleController.getRole);
router.delete(
  "/roles/:id",
  authorize("role", "delete"),
  RoleController.removeRole,
);

// INVITATIONS
router.get(
  "/invitations",
  authorize("invitation", "manage"),
  InvitationController.getInvitationsByTenantID,
);
router.post(
  "/invitations",
  authorize("invitation", "manage"),
  InvitationController.createInvitation,
);
router.delete(
  "/invitations/:token",
  authorize("invitation", "manage"),
  InvitationController.deleteInvitation,
);
router.get(
  "/invitations/:token/verify",
  authorize("invitation", "respond"),
  InvitationController.verifyInvitationToken,
);
router.post(
  "/invitations/:token/accept",
  authorize("invitation", "respond"),
  InvitationController.acceptInvitationToken,
);
router.post(
  "/invitations/:token/reject",
  authorize("invitation", "respond"),
  InvitationController.rejectInvitationToken,
);
router.post(
  "/invitations/resend",
  authorize("invitation", "manage"),
  InvitationController.resendInvitation,
);

// CHALLENGES
router.get(
  "/challenges",
  authorize("tenant", "challenge"),
  TenantController.getChallenges,
);
router.post(
  "/challenges",
  authorize("tenant", "challenge"),
  TenantController.createChallenge,
);
router.put(
  "/challenges",
  authorize("tenant", "challenge"),
  TenantController.updateChallenge,
);
router.delete(
  "/challenges/:id",
  authorize("tenant", "challenge"),
  TenantController.deleteChallenge,
);

router.post(
  "/invitations/approve",
  authorize("invitation", "manage"),
  InvitationController.approveManualChallenge,
);
router.post(
  "/invitations/reject",
  authorize("invitation", "manage"),
  InvitationController.rejectManualChallenge,
);
router.delete(
  "/invitations/user/:userId",
  authorize("invitation", "manage"),
  InvitationController.deleteUserInvitation,
);

router.use("/catalog", require("./routes/catalog.routes"));
router.use("/locker", require("./routes/locker.routes"));
router.use("/access", require("./routes/access.routes"));
router.use("/access-apps", require("./routes/access-app.routes"));
router.use("/accesspoints", require("./routes/access-point.routes"));
router.use("/ical", require("./routes/ical.routes"));

module.exports = router;
