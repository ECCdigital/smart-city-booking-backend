const { asyncRouter } = require("../../../middleware/async-router");
const ICalController = require("../controllers/ical-controller");
const {
  authorize,
  publicRoute,
} = require("../../../commons/services/authorization");
const {
  publicTenantGate,
} = require("../../../commons/services/supervision/public-tenant-gate");

const router = asyncRouter();

// Events: the public calendar for everyone; `?includePrivate=true` adds what
// the reach covers (authorize spec §3.1).
router.get(
  "/events",
  publicRoute("ical", "events"),
  publicTenantGate(),
  ICalController.getEventsIcal,
);
router.get(
  "/events/:id",
  publicRoute("ical", "events"),
  publicTenantGate(),
  ICalController.getEventIcal,
);

// Feed: the subscribable calendar, public events only.
router.get(
  "/feed/events",
  publicRoute("ical", "feed"),
  publicTenantGate(),
  ICalController.getEventsFeed,
);
router.get(
  "/feed/events/:id",
  publicRoute("ical", "feed"),
  publicTenantGate(),
  ICalController.getEventFeed,
);

// Bookings
router.get(
  "/bookings",
  authorize("ical", "bookings"),
  ICalController.getBookingsIcal,
);
router.get(
  "/bookings/:id",
  authorize("ical", "bookings"),
  ICalController.getBookingIcal,
);

module.exports = router;
