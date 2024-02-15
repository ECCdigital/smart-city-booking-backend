var express = require("express");
const AuthenticationController = require("../authentication/controllers/authentication-controller");
const BookableController = require("./controllers/bookable-controller");
const EventController = require("./controllers/event-controller");
const PaymentController = require("./controllers/payment-controller");
const UserController = require("./controllers/user-controller");
const CalendarController = require("./controllers/calendar-controller");
const CouponController = require("./controllers/coupon-controller");
const ExportController = require("../exporters/controllers/csv-export-controller");
const BookingController = require("./controllers/booking-controller");
const CheckoutController = require("./controllers/checkout-controller");
const NextCloudController = require("./controllers/next-cloud-controller");

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
  CalendarController.getBookableAvailabilty,
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

// CHECKOUT
// ========
router.post("/checkout", CheckoutController.checkout);
router.post("/checkout/validateItem", CheckoutController.validateItem);

// PAYMENTS
// ========

// Public
router.post("/payments", PaymentController.getPaymentUrl);
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
router.get("/files/list", NextCloudController.getFiles);
router.get("/files/get", NextCloudController.getFile);
router.post("/files", NextCloudController.createFile);

module.exports = router;
