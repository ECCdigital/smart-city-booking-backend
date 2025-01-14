var express = require("express");
const AuthenticationController = require("../authentication/controllers/authentication-controller");
const BookableController = require("./controllers/bookable-controller");
const EventController = require("./controllers/event-controller");
const PaymentController = require("./controllers/payment-controller");
const UserController = require("./controllers/user-controller");
const CalendarController = require("./controllers/calendar-controller");
const CouponController = require("./controllers/coupon-controller");
const { BookingController } = require("./controllers/booking-controller");
const CheckoutController = require("./controllers/checkout-controller");
const FileController = require("./controllers/file-controller");
const WorkflowController = require("./controllers/workflow-controller");

var router = express.Router({ mergeParams: true });

// BOOKABLES
// =========

//Public
router.get("/bookables", BookableController.getBookables);
router.get("/bookables/:id", BookableController.getBookable);
router.get("/bookables/:id/bookings", BookingController.getRelatedBookings);
router.get("/bookables/:id/openingHours", BookableController.getOpeningHours);
router.get(
  "/bookables/:id/availability",
  CalendarController.getBookableAvailabilityFixed,
);

// Protected
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
router.get(
  "/bookings/:id/reject",
  AuthenticationController.isSignedIn,
  BookingController.rejectBooking,
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

// PAYMENTS
// ========

// Public
router.post("/payments", PaymentController.createPayment);
router.get("/payments/notify", PaymentController.paymentNotification);
router.post("/payments/response", PaymentController.paymentResponse);

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
router.get("/workflow", WorkflowController.getWorkflow);
router.put("/workflow/task", WorkflowController.updateTask);

module.exports = router;
