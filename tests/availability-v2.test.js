const assert = require("assert");
const sinon = require("sinon");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const CalendarServiceV2 = require("../src/commons/services/calendar-service-v2");
const {
  AvailabilityContext,
} = require("../src/commons/services/availability/availability-context");
const {
  CheckoutPermissions,
} = require("../src/commons/services/checkout/checkout-permissions");

describe("BookingManager.filterConcurrentBookings", () => {
  const bookings = [
    {
      id: "b1",
      timeBegin: 1000,
      timeEnd: 2000,
      isRejected: false,
    },
    {
      id: "b2",
      timeBegin: 3000,
      timeEnd: 4000,
      isRejected: true,
    },
    {
      id: "b3",
      timeBegin: 5000,
      timeEnd: 6000,
      isRejected: false,
    },
  ];

  it("returns overlapping non-rejected bookings", () => {
    const result = BookingManager.filterConcurrentBookings(
      bookings,
      1500,
      2500,
    );

    assert.deepStrictEqual(result.map((b) => b.id), ["b1"]);
  });

  it("excludes rejected bookings and ignored booking ids", () => {
    const result = BookingManager.filterConcurrentBookings(
      bookings,
      0,
      10000,
      "b1",
    );

    assert.deepStrictEqual(result.map((b) => b.id), ["b3"]);
  });
});

describe("AvailabilityContext in-memory lookups", () => {
  const {
    AvailabilityContext,
  } = require("../src/commons/services/availability/availability-context");

  it("indexes and filters bookings by bookable id", () => {
    const context = new AvailabilityContext({
      tenantId: "tenant-1",
      bookableId: "room-a",
      timeBegin: 0,
      timeEnd: 10000,
    });

    context.bookingsByBookableId = new Map([
      [
        "room-a",
        [
          {
            id: "booking-1",
            timeBegin: 1000,
            timeEnd: 3000,
            isRejected: false,
            bookableItems: [{ bookableId: "room-a", amount: 1 }],
          },
        ],
      ],
      [
        "room-b",
        [
          {
            id: "booking-2",
            timeBegin: 4000,
            timeEnd: 6000,
            isRejected: false,
            bookableItems: [{ bookableId: "room-b", amount: 1 }],
          },
        ],
      ],
    ]);

    const concurrent = context.getConcurrentBookings("room-a", 500, 2500);
    assert.strictEqual(concurrent.length, 1);
    assert.strictEqual(concurrent[0].id, "booking-1");

    const unrelated = context.getConcurrentBookings("room-a", 3500, 3900);
    assert.strictEqual(unrelated.length, 0);
  });
});

describe("CalendarServiceV2 opening-hours handling", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("keeps parent closed hours unavailable when child has no time periods", async () => {
    const childBookable = {
      id: "child-room",
      title: "Child Room",
      tenantId: "tenant-1",
      type: "room",
      amount: 1,
      isBookable: true,
      isScheduleRelated: false,
      isTimePeriodRelated: false,
      isOpeningHoursRelated: false,
      openingHours: [],
      timePeriods: [],
    };
    const parentBookable = {
      id: "parent-room",
      title: "Parent Room",
      tenantId: "tenant-1",
      amount: 1,
      isOpeningHoursRelated: true,
      openingHours: [
        {
          weekdays: [1], // Monday
          startTime: "08:00",
          endTime: "18:00",
        },
      ],
    };

    sinon.stub(CheckoutPermissions, "_allowCheckout").resolves(true);
    sinon.stub(AvailabilityContext, "create").resolves({
      tenantId: "tenant-1",
      tenant: {},
      bookable: childBookable,
      parentBookables: [parentBookable],
      relatedBookables: [],
      event: null,
      eventBookings: [],
      metrics: {
        dbQueryCount: 0,
        segmentChecks: 0,
      },
      recordSegmentCheck() {
        this.metrics.segmentChecks += 1;
      },
      getConcurrentBookings() {
        return [];
      },
      getRelatedBookings() {
        return [];
      },
      getRelatedBookablesFor() {
        return [];
      },
    });

    const result = await CalendarServiceV2.checkAvailability(
      "tenant-1",
      "child-room",
      "2026-06-15",
      "2026-06-15",
      1,
      { id: "user-1" },
    );

    const dayStart = new Date("2026-06-15T00:00:00").getTime();
    const atHour = (h) => dayStart + h * 60 * 60 * 1000;
    const isUnavailableAt = (timestamp) =>
      result.availability.some(
        (segment) =>
          !segment.available &&
          segment.timeBegin <= timestamp &&
          timestamp < segment.timeEnd,
      );
    const isAvailableAt = (timestamp) =>
      result.availability.some(
        (segment) =>
          segment.available &&
          segment.timeBegin <= timestamp &&
          timestamp < segment.timeEnd,
      );

    assert.strictEqual(isUnavailableAt(atHour(6)), true);
    assert.strictEqual(isAvailableAt(atHour(10)), true);
    assert.strictEqual(isUnavailableAt(atHour(20)), true);
  });
});
