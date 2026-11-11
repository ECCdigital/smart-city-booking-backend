/**
 * The capacity of a bookable for the availability (tickets#1041): the
 * smaller of `amount` and the number of Fächer in Betrieb of every
 * Schließfachanlage with its own list; an empty `amount` counts as that
 * number, a Fach außer Betrieb does not count, and without such an Anlage
 * it stays `amount` (iFBS and Pareva included). The storefront's calendar
 * (`CalendarServiceV2`) and the checkout's availability check both read it.
 */

const assert = require("assert");
const sinon = require("sinon");
const {
  ItemCheckoutService,
  CHECK_TYPES,
} = require("../src/commons/services/checkout/item-checkout-service");
const CalendarServiceV2 = require("../src/commons/services/calendar-service-v2");
const {
  AvailabilityContext,
} = require("../src/commons/services/availability/availability-context");
const {
  CheckoutPermissions,
} = require("../src/commons/services/checkout/checkout-permissions");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const { DOMAIN } = require("../src/commons/services/authorization/reach");

const TENANT = "tenant-1";
const TIME_BEGIN = Date.UTC(2027, 5, 21, 10, 0, 0);
const TIME_END = Date.UTC(2027, 5, 21, 12, 0, 0);

/** A Fach of an Anlage's own list, in Betrieb unless said otherwise. */
function fach(number, overrides = {}) {
  return {
    id: `uuid-${number}`,
    number,
    lockerBank: { id: "bank-1", name: "Labor Fachbank 1" },
    outOfService: false,
    ...overrides,
  };
}

/** A Schließfachanlage of Open Locker that carries its own Fächer. */
function anlage(id, compartments) {
  return {
    id,
    tenantId: TENANT,
    type: "locker",
    provider: "open-locker",
    mode: "remote",
    externalId: "",
    label: "Fahrradgarage",
    config: { compartments },
  };
}

/** An iFBS Anlage: the provider assigns, it carries no list. */
const IFBS_ANLAGE = {
  id: "ifbs-anlage",
  tenantId: TENANT,
  type: "locker",
  provider: "ifbs",
  externalId: "location-1",
  label: "Fahrradbox",
  config: {},
};

function lockerBookable(overrides = {}) {
  return new Bookable({
    id: "locker",
    tenantId: TENANT,
    title: "Schließfach",
    type: "resource",
    isBookable: true,
    isScheduleRelated: true,
    amount: 5,
    permittedUsers: [],
    permittedRoles: [],
    bookingDiscounts: { users: [], roles: [] },
    checkoutBookableIds: [],
    externalProviders: [],
    attachments: [],
    priceType: "per-item",
    priceValueAddedTax: 0,
    priceCategories: [{ priceEur: 5, interval: { start: null, end: null } }],
    accessPointDetails: { active: true, accessPointIds: ["anlage-1"] },
    ...overrides,
  });
}

/** A booking of `amount` of the bookable from `timeBegin` to `timeEnd`. */
function booked(id, amount = 1, timeBegin = TIME_BEGIN, timeEnd = TIME_END) {
  return {
    id,
    isRejected: false,
    timeBegin,
    timeEnd,
    bookableItems: [{ bookableId: "locker", amount }],
  };
}

describe("Kapazität des Buchungsobjekts", function () {
  let accessPoints;

  beforeEach(function () {
    accessPoints = [anlage("anlage-1", [fach(1), fach(2)])];
    sinon
      .stub(AccessPointManager, "getAccessPointsByIds")
      .callsFake(async (tenantId, ids) =>
        accessPoints.filter(
          (row) => row.tenantId === tenantId && ids.includes(row.id),
        ),
      );
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("ItemCheckoutService.checkAvailability", function () {
    let bookable;
    let concurrentBookings;

    beforeEach(function () {
      bookable = lockerBookable();
      concurrentBookings = [];

      sinon
        .stub(BookableManager, "getBookable")
        .callsFake(async () => bookable);
      sinon.stub(BookableManager, "getAncestorBookables").resolves([]);
      sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
      sinon
        .stub(TenantManager, "getTenant")
        .resolves({ id: TENANT, applications: [] });
      sinon
        .stub(BookingManager, "getConcurrentBookings")
        .callsFake(async () => concurrentBookings);
      sinon.stub(BookingManager, "getRelatedBookings").resolves([]);
    });

    async function checkAvailability(amount = 1) {
      const ics = new ItemCheckoutService({
        user: "erika@example.test",
        tenantId: TENANT,
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
        bookableId: "locker",
        amount,
      });
      await ics.init();
      return ics.checkAvailability();
    }

    function refused(promise, check = () => {}) {
      return assert.rejects(promise, (err) => {
        assert.strictEqual(err.checkType, CHECK_TYPES.AVAILABILITY);
        assert.strictEqual(err.available, false);
        check(err);
        return true;
      });
    }

    it("refuses when every Fach in Betrieb is booked, though amount has room", async function () {
      concurrentBookings = [booked("B1"), booked("B2")];

      await refused(checkAvailability(1), (err) => {
        assert.strictEqual(err.totalCapacity, 2);
        assert.strictEqual(err.booked, 2);
        assert.strictEqual(err.remaining, 0);
      });
    });

    it("passes while a Fach is free and answers the Fächer as the capacity", async function () {
      concurrentBookings = [booked("B1")];

      const result = await checkAvailability(1);

      assert.strictEqual(result.available, true);
      assert.strictEqual(result.totalCapacity, 2);
      assert.strictEqual(result.booked, 1);
      assert.strictEqual(result.remaining, 1);
    });

    it("keeps amount when it is smaller than the Fächer", async function () {
      bookable = lockerBookable({ amount: 1 });
      accessPoints = [anlage("anlage-1", [fach(1), fach(2), fach(3)])];
      concurrentBookings = [booked("B1")];

      await refused(checkAvailability(1), (err) => {
        assert.strictEqual(err.totalCapacity, 1);
      });
    });

    it("counts an empty amount as the Fächer in Betrieb", async function () {
      bookable = lockerBookable({ amount: null });
      concurrentBookings = [booked("B1")];

      const result = await checkAvailability(1);
      assert.strictEqual(result.totalCapacity, 2);

      concurrentBookings = [booked("B1"), booked("B2")];
      await refused(checkAvailability(1));
    });

    it("leaves a Fach außer Betrieb out of the capacity", async function () {
      accessPoints = [
        anlage("anlage-1", [fach(1), fach(2, { outOfService: true }), fach(3)]),
      ];
      concurrentBookings = [booked("B1"), booked("B2")];

      await refused(checkAvailability(1), (err) => {
        assert.strictEqual(err.totalCapacity, 2);
      });
    });

    it("refuses every booking while all Fächer are außer Betrieb", async function () {
      accessPoints = [anlage("anlage-1", [fach(1, { outOfService: true })])];

      await refused(checkAvailability(1), (err) => {
        assert.strictEqual(err.totalCapacity, 0);
        assert.strictEqual(err.booked, 0);
      });
    });

    it("takes the smallest of several Anlagen with their own list", async function () {
      bookable = lockerBookable({
        accessPointDetails: {
          active: true,
          accessPointIds: ["anlage-1", "anlage-2"],
        },
      });
      accessPoints = [
        anlage("anlage-1", [fach(1), fach(2), fach(3)]),
        anlage("anlage-2", [fach(4)]),
      ];
      concurrentBookings = [booked("B1")];

      await refused(checkAvailability(1), (err) => {
        assert.strictEqual(err.totalCapacity, 1);
      });
    });

    it("stays amount for an Anlage whose provider assigns (iFBS)", async function () {
      bookable = lockerBookable({
        amount: 3,
        accessPointDetails: { active: true, accessPointIds: [IFBS_ANLAGE.id] },
      });
      accessPoints = [IFBS_ANLAGE];
      concurrentBookings = [booked("B1"), booked("B2")];

      const result = await checkAvailability(1);

      assert.strictEqual(result.totalCapacity, 3);
      assert.strictEqual(result.remaining, 1);
    });

    it("stays amount while the bookable's access points are switched off", async function () {
      bookable = lockerBookable({
        accessPointDetails: { active: false, accessPointIds: ["anlage-1"] },
      });
      concurrentBookings = [booked("B1"), booked("B2")];

      const result = await checkAvailability(1);

      assert.strictEqual(result.totalCapacity, 5);
    });
  });

  describe("CalendarServiceV2.checkAvailability", function () {
    const DAY = "2027-06-14";
    const dayStart = new Date(`${DAY}T00:00:00`).getTime();
    const atHour = (hour) => dayStart + hour * 60 * 60 * 1000;

    let bookable;
    let bookings;

    beforeEach(function () {
      bookable = lockerBookable();
      bookings = [];

      sinon.stub(CheckoutPermissions, "_allowCheckout").resolves(true);
      sinon.stub(AvailabilityContext, "create").callsFake(async () => ({
        tenantId: TENANT,
        tenant: {},
        bookable,
        parentBookables: [],
        relatedBookables: [],
        event: null,
        eventBookings: [],
        metrics: { dbQueryCount: 0, segmentChecks: 0 },
        recordSegmentCheck() {
          this.metrics.segmentChecks += 1;
        },
        getConcurrentBookings(bookableId, timeBegin, timeEnd) {
          return BookingManager.filterConcurrentBookings(
            bookings,
            timeBegin,
            timeEnd,
          );
        },
        getRelatedBookings() {
          return bookings;
        },
        getRelatedBookablesFor() {
          return [];
        },
      }));
    });

    async function availability(amount = 1) {
      const result = await CalendarServiceV2.checkAvailability(
        TENANT,
        "locker",
        DAY,
        DAY,
        amount,
        { id: "user-1" },
        DOMAIN,
      );
      return (timestamp) =>
        result.availability.find(
          (segment) =>
            segment.timeBegin <= timestamp && timestamp < segment.timeEnd,
        )?.available;
    }

    /** Two bookings over 10-12 o'clock of the day. */
    function twoBookedFrom10To12() {
      bookings = [
        booked("B1", 1, atHour(10), atHour(12)),
        booked("B2", 1, atHour(10), atHour(12)),
      ];
    }

    it("shows a period as booked out once every Fach in Betrieb is booked", async function () {
      twoBookedFrom10To12();

      const availableAt = await availability(1);

      assert.strictEqual(availableAt(atHour(11)), false);
      assert.strictEqual(availableAt(atHour(14)), true);
    });

    it("shows no period for more units than Fächer in Betrieb", async function () {
      const availableAt = await availability(3);

      assert.strictEqual(availableAt(atHour(14)), false);
    });

    it("counts an empty amount as the Fächer in Betrieb", async function () {
      bookable = lockerBookable({ amount: null });
      twoBookedFrom10To12();

      const availableAt = await availability(1);

      assert.strictEqual(availableAt(atHour(11)), false);
      assert.strictEqual(availableAt(atHour(14)), true);
    });

    it("leaves a Fach außer Betrieb out of the capacity", async function () {
      accessPoints = [
        anlage("anlage-1", [fach(1), fach(2, { outOfService: true }), fach(3)]),
      ];
      twoBookedFrom10To12();

      const availableAt = await availability(1);

      assert.strictEqual(availableAt(atHour(11)), false);
      assert.strictEqual(availableAt(atHour(14)), true);
    });

    it("shows no period while all Fächer are außer Betrieb", async function () {
      accessPoints = [
        anlage("anlage-1", [
          fach(1, { outOfService: true }),
          fach(2, { outOfService: true }),
        ]),
      ];

      const availableAt = await availability(1);

      assert.strictEqual(availableAt(atHour(14)), false);
    });

    it("stays amount without an Anlage with its own list", async function () {
      bookable = lockerBookable({
        amount: 3,
        accessPointDetails: { active: true, accessPointIds: [IFBS_ANLAGE.id] },
      });
      accessPoints = [IFBS_ANLAGE];
      twoBookedFrom10To12();

      const availableAt = await availability(1);

      assert.strictEqual(availableAt(atHour(11)), true);
    });
  });
});
