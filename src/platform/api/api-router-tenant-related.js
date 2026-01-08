const express = require("express");
const AuthenticationController = require("../authentication/controllers/authentication-controller");
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
const CatalogController = require("./controllers/catalog-controller");
const { optionalAuth } = require("../../middleware/auth-middleware");

const router = express.Router({ mergeParams: true });

// BOOKABLES
// =========

//Public
router.get(
  "/bookables/public",
  optionalAuth,
  BookableController.getPublicBookables,
);
router.get(
  "/bookables/public/:id",
  optionalAuth,
  BookableController.getPublicBookable,
);
router.get("/bookables/:id/bookings", BookingController.getRelatedBookings);
router.get("/bookables/:id/openingHours", BookableController.getOpeningHours);
router.get(
  "/bookables/:id/availability",
  optionalAuth,
  CalendarController.getBookableAvailability,
);
router.get("/bookables/:id/occupancy", BookableController.getBookableOccupancy);

// Protected
router.get(
  "/bookables",
  AuthenticationController.isSignedIn,
  BookableController.getBookables,
);
router.get(
  "/bookables/:id",
  AuthenticationController.isSignedIn,
  BookableController.getBookable,
);

router.put(
  "/bookables",
  AuthenticationController.isSignedIn,
  BookableController.storeBookable,
);

router.delete(
  "/bookables/:id",
  AuthenticationController.isSignedIn,
  BookableController.removeBookable,
);
router.get(
  "/bookables/_meta/tags",
  AuthenticationController.isSignedIn,
  BookableController.getTags,
);
router.get(
  "/bookables/count/check",
  AuthenticationController.isSignedIn,
  BookableController.countCheck,
);

// EVENTS
// ======

// Public
router.get("/events", EventController.getEvents);
router.get("/events/:id", EventController.getEvent);
router.get("/events/:id/bookings", BookingController.getEventBookings);

// Protected
router.put(
  "/events",
  AuthenticationController.isSignedIn,
  EventController.storeEvent,
);
router.delete(
  "/events/:id",
  AuthenticationController.isSignedIn,
  EventController.removeEvent,
);
router.get(
  "/events/_meta/tags",
  AuthenticationController.isSignedIn,
  EventController.getTags,
);
router.get(
  "/events/count/check",
  AuthenticationController.isSignedIn,
  EventController.countCheck,
);
router.get(
  "/events/:id/count",
  AuthenticationController.isSignedIn,
  EventController.getBookedSeatsCount,
);

// BOOKINGS
// ========

// Public
router.get("/bookings", optionalAuth, BookingController.getBookings);

router.get("/bookings/:ids/status", BookingController.getBookingStatus);
router.get(
  "/bookings/:id/status/public",
  BookingController.getPublicBookingStatus,
);

// Protected
router.get(
  "/bookings/:id",
  AuthenticationController.isSignedIn,
  BookingController.getBooking,
);

router.put(
  "/bookings",
  AuthenticationController.isSignedIn,
  BookingController.storeBooking,
);
router.get(
  "/mybookings",
  AuthenticationController.isSignedIn,
  BookingController.getAssignedBookings,
);
router.delete(
  "/bookings/:id",
  AuthenticationController.isSignedIn,
  BookingController.removeBooking,
);
router.get(
  "/bookings/:id/commit",
  AuthenticationController.isSignedIn,
  BookingController.commitBooking,
);
router.post(
  "/bookings/:id/pay",
  AuthenticationController.isSignedIn,
  BookingController.payBooking,
);
router.post(
  "/bookings/:id/reject",
  AuthenticationController.isSignedIn,
  BookingController.rejectBooking,
);
router.post(
  "/bookings/:id/request-reject",
  BookingController.requestRejectBooking,
);
router.get(
  "/bookings/:id/verify-ownership",
  BookingController.verifyBookingOwnership,
);
router.get(
  "/bookings/:id/hooks/:hookId/release",
  BookingController.releaseBookingHook,
);
router.post(
  "/bookings/:id/receipt",
  AuthenticationController.isSignedIn,
  BookingController.createReceipt,
);

router.get(
  "/bookings/:id/receipt/:receiptId",
  AuthenticationController.isSignedIn,
  BookingController.getReceipt,
);

// USERS
// =====
router.get(
  "/users",
  AuthenticationController.isSignedIn,
  TenantController.getUsers,
);

// GROUP BOOKINGS
// ==============
router.get(
  "/group-bookings",
  AuthenticationController.isSignedIn,
  GroupBookingController.getGroupBookings,
);
router.get(
  "/group-bookings/:id",
  AuthenticationController.isSignedIn,
  GroupBookingController.getGroupBooking,
);
router.post(
  "/group-bookings/:id/commit",
  AuthenticationController.isSignedIn,
  GroupBookingController.commitGroupBooking,
);
router.post(
  "/group-bookings/:id/pay",
  AuthenticationController.isSignedIn,
  GroupBookingController.payGroupBooking,
);
router.post(
  "/group-bookings/:id/reject",
  AuthenticationController.isSignedIn,
  GroupBookingController.rejectGroupBooking,
);
router.get(
  "/group-bookings/booking/:bookingId",
  AuthenticationController.isSignedIn,
  GroupBookingController.getGroupBookingByBookingId,
);
router.delete(
  "/group-bookings/:id",
  AuthenticationController.isSignedIn,
  GroupBookingController.removeGroupBooking,
);
router.post(
  "/group-bookings/:id/receipt",
  AuthenticationController.isSignedIn,
  GroupBookingController.createGroupBookingReceipt,
);

// CHECKOUT
// ========
router.post("/checkout", optionalAuth, CheckoutController.checkout);
router.post("/checkout/group", optionalAuth, CheckoutController.groupCheckout);
router.post(
  "/checkout/validateItem",
  optionalAuth,
  CheckoutController.validateItem,
);
router.get(
  "/checkout/permissions/:id",
  optionalAuth,
  CheckoutController.checkoutPermissions,
);

// PAYMENTS
// ========

// Public
router.post("/payments", PaymentController.createPayment);
router.get("/payments/notify", PaymentController.paymentNotificationGET);
router.post("/payments/notify", PaymentController.paymentNotificationPOST);
router.post("/payments/response", PaymentController.paymentResponse);
router.get("/payments/response", PaymentController.paymentResponse);

// CALENDAR
// ========
router.get("/calendar/occupancy", CalendarController.getOccupancies);

// COUPONS
// =======
router.get("/coupons", optionalAuth, CouponController.getCoupons);
router.get("/coupons/:id", CouponController.getCoupon);
router.put(
  "/coupons",
  AuthenticationController.isSignedIn,
  CouponController.storeCoupon,
);
router.delete(
  "/coupons/:id",
  AuthenticationController.isSignedIn,
  CouponController.deleteCoupon,
);

// NEXT CLOUD
// ==========
router.get("/files/list", optionalAuth, FileController.getTenantFiles);
router.get("/files/get", optionalAuth, FileController.getTenantFile);
router.post(
  "/files",
  AuthenticationController.isSignedIn,
  FileController.createTenantFile,
);

// WORKFLOW
// ========
// Protected
router.get(
  "/workflow/",
  AuthenticationController.isSignedIn,
  WorkflowController.getWorkflow,
);
router.post(
  "/workflow/",
  AuthenticationController.isSignedIn,
  WorkflowController.createWorkflow,
);
router.put(
  "/workflow/",
  AuthenticationController.isSignedIn,
  WorkflowController.updateWorkflow,
);
router.get(
  "/workflow/states",
  AuthenticationController.isSignedIn,
  WorkflowController.getWorkflowStates,
);
router.put(
  "/workflow/task",
  AuthenticationController.isSignedIn,
  WorkflowController.updateTask,
);
router.put(
  "/workflow/archive",
  AuthenticationController.isSignedIn,
  WorkflowController.archiveTask,
);
router.get(
  "/workflow/backlog",
  AuthenticationController.isSignedIn,
  WorkflowController.getBacklog,
);
// ROLES
// =====

// Protected
router.get(
  "/roles",
  AuthenticationController.isSignedIn,
  RoleController.getRoles,
);
router.get(
  "/roles/tenant",
  AuthenticationController.isSignedIn,
  RoleController.getUserRolesByTenant,
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

// INVITATIONS
router.get(
  "/invitations",
  AuthenticationController.isSignedIn,
  InvitationController.getInvitationsByTenantID,
);

router.post(
  "/invitations",
  AuthenticationController.isSignedIn,
  InvitationController.createInvitation,
);

router.delete(
  "/invitations/:token",
  AuthenticationController.isSignedIn,
  InvitationController.deleteInvitation,
);

router.get(
  "/invitations/:token/verify",
  AuthenticationController.isSignedIn,
  InvitationController.verifyInvitationToken,
);
router.post(
  "/invitations/:token/accept",
  AuthenticationController.isSignedIn,
  InvitationController.acceptInvitationToken,
);

router.post(
  "/invitations/:token/reject",
  AuthenticationController.isSignedIn,
  InvitationController.rejectInvitationToken,
);

router.post(
  "/invitations/resend",
  AuthenticationController.isSignedIn,
  InvitationController.resendInvitation,
);

router.get(
  "/challenges",
  AuthenticationController.isSignedIn,
  TenantController.getChallenges,
);

router.post(
  "/challenges",
  AuthenticationController.isSignedIn,
  TenantController.createChallenge,
);

router.put(
  "/challenges",
  AuthenticationController.isSignedIn,
  TenantController.updateChallenge,
);

router.delete(
  "/challenges/:id",
  AuthenticationController.isSignedIn,
  TenantController.deleteChallenge,
);

router.post(
  "/invitations/approve",
  AuthenticationController.isSignedIn,
  InvitationController.approveManualChallenge,
);

router.post(
  "/invitations/reject",
  AuthenticationController.isSignedIn,
  InvitationController.rejectManualChallenge,
);

router.delete(
  "/invitations/user/:userId",
  AuthenticationController.isSignedIn,
  InvitationController.deleteUserInvitation,
);

// CATALOG

router.get(
  "/catalog",
  AuthenticationController.isSignedIn,
  CatalogController.getCatalogByTenant,
);
router.put(
  "/catalog",
  AuthenticationController.isSignedIn,
  CatalogController.storeCatalog,
);

module.exports = router;
