var express = require("express");
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
const RoleController = require("./controllers/role-controller");

const router = express.Router({ mergeParams: true });

// BOOKABLES
// =========

//Public
router.get("/bookables/public", BookableController.getPublicBookables);
router.get("/bookables/public/:id", BookableController.getPublicBookable);
router.get("/bookables/:id/bookings", BookingController.getRelatedBookings);
router.get("/bookables/:id/openingHours", BookableController.getOpeningHours);
router.get(
  "/bookables/:id/availability",
  CalendarController.getBookableAvailabilityFixed,
);

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

// BOOKINGS
// ========

// Public
router.get("/bookings", BookingController.getBookings);

router.get("/bookings/:id/status", BookingController.getBookingStatus);
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

// CHECKOUT
// ========
router.post("/checkout", CheckoutController.checkout);
router.post("/checkout/validateItem", CheckoutController.validateItem);
router.get("/checkout/permissions/:id", CheckoutController.checkoutPermissions);

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
router.get("/coupons", CouponController.getCoupons);
router.get("/coupons/:id", CouponController.getCoupon);
router.put("/coupons", CouponController.storeCoupon);
router.delete("/coupons/:id", CouponController.deleteCoupon);

// NEXT CLOUD
// ==========
router.get("/files/list", FileController.getFiles);
router.get("/files/get", FileController.getFile);
router.post(
  "/files",
  AuthenticationController.isSignedIn,
  FileController.createFile,
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
