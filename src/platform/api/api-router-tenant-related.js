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
  "/bookables/:id/availability/v1",
  optionalAuth,
  CalendarController.getBookableAvailabilityV1,
);
router.get(
  "/bookables/:id/availability/v2",
  optionalAuth,
  CalendarController.getBookableAvailabilityV2,
);
router.get(
  "/bookables/:id/availability",
  optionalAuth,
  CalendarController.getBookableAvailability,
);
router.get(
  "/bookables/:id/block-periods",
  optionalAuth,
  CalendarController.getBookableBlockPeriods,
);
router.get("/bookables/:id/occupancy", BookableController.getBookableOccupancy);

router.get(
  "/bookables/:id/prices",
  BookableController.getBookablePriceCategories,
);

// Protected
router.get(
  "/bookables",
  AuthenticationController.isSignedIn,
  BookableController.getBookables,
);

router.get(
  "/bookables/_template",
  AuthenticationController.isSignedIn,
  BookableController.getBookableTemplate,
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

router.get("/bookings", optionalAuth, BookingController.getBookings);

router.put(
  "/bookings",
  AuthenticationController.isSignedIn,
  BookingController.storeBooking,
);
router.get(
  "/bookings/assigned",
  AuthenticationController.isSignedIn,
  BookingController.getAssignedBookings,
);

router.get(
  "/bookings/:id",
  AuthenticationController.isSignedIn,
  BookingController.getBooking,
);

router.delete(
  "/bookings/:id",
  AuthenticationController.isSignedIn,
  BookingController.removeBooking,
);

router.get(
  "/bookings/:ids/status",
  optionalAuth,
  BookingController.getBookingStatus,
);

router.get(
  "/bookings/:id/status/public",
  BookingController.getPublicBookingStatus,
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
router.get(
  "/bookings/:id/cancellation-refund-preview",
  AuthenticationController.isSignedIn,
  BookingController.getCancellationRefundPreview,
);
router.get(
  "/bookings/:id/cancellation-refund-preview/public",
  BookingController.getPublicCancellationRefundPreview,
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
  "/bookings/:id/hooks/:hookId/cancellation-refund-preview",
  BookingController.getHookCancellationRefundPreview,
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

router.get(
  "/bookings/:id/invoice/:invoiceId",
  AuthenticationController.isSignedIn,
  BookingController.getInvoice,
);

router.post(
  "/bookings/:id/invoice",
  AuthenticationController.isSignedIn,
  BookingController.createInvoice,
);

router.get(
  "/bookings/:id/cancellation-receipt/:cancellationReceiptId",
  AuthenticationController.isSignedIn,
  BookingController.getCancellationReceipt,
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
router.put(
  "/group-bookings/:id",
  AuthenticationController.isSignedIn,
  GroupBookingController.updateGroupBooking,
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
router.get(
  "/group-bookings/:id/cancellation-refund-preview",
  AuthenticationController.isSignedIn,
  GroupBookingController.getCancellationRefundPreview,
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
router.post(
  "/group-bookings/:id/invoice",
  AuthenticationController.isSignedIn,
  GroupBookingController.createGroupBookingInvoice,
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
router.post("/payments", optionalAuth, PaymentController.createPayment);
router.get("/payments/notify", PaymentController.paymentNotificationGET);
router.post("/payments/notify", PaymentController.paymentNotificationPOST);
router.post("/payments/response", PaymentController.paymentResponse);
router.get("/payments/response", PaymentController.paymentResponse);
router.get(
  "/payments/providers/:provider/test",
  AuthenticationController.isSignedIn,
  PaymentController.testConnection,
);

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

// LEGACY FILES
// ============
// The tenant listing and upload are gone with the media library — the admin UI
// picks and uploads media (§4.10). `GET /files/get` stays for good as the
// resolver of stored legacy addresses.
router.get("/files/get", optionalAuth, FileController.getTenantFile);

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

router.use("/catalog", require("./routes/catalog.routes"));
router.use("/locker", require("./routes/locker.routes"));
router.use("/access", require("./routes/access.routes"));
router.use("/ical", require("./routes/ical.routes"));

module.exports = router;
