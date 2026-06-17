const assert = require("assert");
const BookingManager = require("../src/commons/data-managers/booking-manager");

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
