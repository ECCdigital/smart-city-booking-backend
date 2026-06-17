const assert = require("assert");
const {
  isTimeRelatedBookable,
  sumBookedAmount,
  sumBookedAmountForBookableSet,
  getBookedAmountForBookable,
  evaluateOriginCapacity,
  evaluateCapacityIntervals,
  evaluateParentCapacity,
  evaluateChildCapacity,
  evaluateTicketParentCapacityIntervals,
  getEventReferenceDate,
  isEventBookable,
  isTicketEventDateBookable,
  hasEventSeats,
  isDurationAllowed,
  getBookingDurationHours,
  isBookableEnabled,
  isUserPermitted,
  hasBookingPermissionSync,
  CAPACITY_MODES,
} = require("../src/commons/availability/availability-rules");

function booking(id, items, overrides = {}) {
  return {
    id,
    isRejected: false,
    timeBegin: 0,
    timeEnd: 10,
    bookableItems: items,
    ...overrides,
  };
}

function item(bookableId, amount) {
  return { bookableId, amount };
}

describe("availability rules R1 — booking-amount", () => {
  it("detects time-related bookables by schedule, period, or long-range flags", () => {
    assert.strictEqual(isTimeRelatedBookable({ isScheduleRelated: true }), true);
    assert.strictEqual(isTimeRelatedBookable({ isTimePeriodRelated: true }), true);
    assert.strictEqual(isTimeRelatedBookable({ isLongRange: true }), true);
    assert.strictEqual(isTimeRelatedBookable({ isScheduleRelated: false }), false);
    assert.strictEqual(isTimeRelatedBookable(null), false);
  });

  it("sums booked amount for a single bookable across bookings", () => {
    const bookings = [
      booking("b1", [item("room-a", 2), item("room-b", 1)]),
      booking("b2", [item("room-a", 3)]),
      booking("b3", [item("room-a", 5)], { isRejected: true }),
    ];

    assert.strictEqual(sumBookedAmount(bookings, "room-a"), 5);
    assert.strictEqual(getBookedAmountForBookable(bookings[0], "room-b"), 1);
  });

  it("sums booked amount across a set of bookable IDs", () => {
    const bookings = [
      booking("b1", [item("parent", 1), item("child-1", 2)]),
      booking("b2", [item("child-2", 3)]),
    ];

    assert.strictEqual(
      sumBookedAmountForBookableSet(bookings, ["parent", "child-1", "child-2"]),
      6,
    );
  });
});

describe("availability rules R1 — capacity-rules", () => {
  const bookableId = "origin";

  it("treats unlimited capacity as always available (additive)", () => {
    const result = evaluateOriginCapacity({
      bookings: [booking("b1", [item(bookableId, 99)])],
      bookableId,
      capacity: null,
      amount: 1,
    });

    assert.strictEqual(result.available, true);
    assert.strictEqual(result.amountBooked, 0);
  });

  it("rejects additive capacity when booked + requested exceeds limit", () => {
    const result = evaluateOriginCapacity({
      bookings: [booking("b1", [item(bookableId, 8)])],
      bookableId,
      capacity: 10,
      amount: 3,
      mode: CAPACITY_MODES.ADDITIVE,
    });

    assert.strictEqual(result.available, false);
    assert.strictEqual(result.amountBooked, 8);
    assert.strictEqual(result.remaining, 2);
  });

  it("uses exclusive mode for parent-style checks (blocks only at full capacity)", () => {
    const partiallyBooked = evaluateOriginCapacity({
      bookings: [booking("b1", [item(bookableId, 1)])],
      bookableId,
      capacity: 10,
      amount: 1,
      mode: CAPACITY_MODES.EXCLUSIVE,
    });

    const fullyBooked = evaluateOriginCapacity({
      bookings: [booking("b1", [item(bookableId, 10)])],
      bookableId,
      capacity: 10,
      amount: 1,
      mode: CAPACITY_MODES.EXCLUSIVE,
    });

    assert.strictEqual(partiallyBooked.available, true);
    assert.strictEqual(fullyBooked.available, false);
  });

  it("computes time-overlap intervals with peak load", () => {
    const windowStart = 0;
    const windowEnd = 100;
    const bookings = [
      booking("b1", [item(bookableId, 4)], { timeBegin: 0, timeEnd: 60 }),
      booking("b2", [item(bookableId, 4)], { timeBegin: 40, timeEnd: 100 }),
    ];

    const intervals = evaluateCapacityIntervals({
      windowStart,
      windowEnd,
      bookings,
      bookableId,
      capacity: 7,
      requestedAmount: 1,
      mode: CAPACITY_MODES.ADDITIVE,
      useTimeOverlap: true,
    });

    const overlap = intervals.find(
      (segment) => segment.timeBegin === 40 && segment.timeEnd === 60,
    );
    assert.ok(overlap);
    assert.strictEqual(overlap.available, false);
  });
});

describe("availability rules R1 — parent-child-rules", () => {
  it("blocks parent in exclusive mode only when capacity is fully used", () => {
    assert.strictEqual(
      evaluateParentCapacity({
        parentAmountBooked: 4,
        capacity: 5,
        requestedAmount: 1,
        isTicketChild: false,
      }),
      true,
    );
    assert.strictEqual(
      evaluateParentCapacity({
        parentAmountBooked: 5,
        capacity: 5,
        requestedAmount: 1,
        isTicketChild: false,
      }),
      false,
    );
  });

  it("adds child ticket bookings for ticket-parent capacity", () => {
    assert.strictEqual(
      evaluateParentCapacity({
        parentAmountBooked: 3,
        childTicketAmountBooked: 4,
        capacity: 10,
        requestedAmount: 2,
        isTicketChild: true,
      }),
      true,
    );
    assert.strictEqual(
      evaluateParentCapacity({
        parentAmountBooked: 3,
        childTicketAmountBooked: 6,
        capacity: 10,
        requestedAmount: 2,
        isTicketChild: true,
      }),
      false,
    );
  });

  it("evaluates child capacity additively", () => {
    assert.strictEqual(
      evaluateChildCapacity({
        childAmountBooked: 2,
        capacity: 5,
        requestedAmount: 2,
      }),
      true,
    );
    assert.strictEqual(
      evaluateChildCapacity({
        childAmountBooked: 4,
        capacity: 5,
        requestedAmount: 2,
      }),
      false,
    );
    assert.strictEqual(
      evaluateChildCapacity({
        childAmountBooked: 99,
        capacity: null,
        requestedAmount: 1,
      }),
      true,
    );
  });

  it("combines parent and child bookings for ticket-parent sweep", () => {
    const parent = { id: "parent", amount: 10 };
    const children = [{ id: "child-a" }, { id: "child-b" }];
    const bookings = [
      booking("b1", [item("parent", 3), item("child-a", 2)], {
        timeBegin: 0,
        timeEnd: 50,
      }),
      booking("b2", [item("child-b", 4)], { timeBegin: 25, timeEnd: 75 }),
    ];

    const intervals = evaluateTicketParentCapacityIntervals({
      windowStart: 0,
      windowEnd: 100,
      bookings,
      parentBookable: parent,
      relatedBookables: children,
      requestedAmount: 2,
      useTimeOverlap: true,
    });

    const peak = intervals.find(
      (segment) => segment.timeBegin === 25 && segment.timeEnd === 50,
    );
    assert.ok(peak);
    assert.strictEqual(peak.available, false);
  });
});

describe("availability rules R1 — event-rules", () => {
  it("parses event reference date from end date and time", () => {
    const event = {
      information: {
        endDate: "2030-06-15",
        endTime: "14:30",
      },
    };

    const ref = getEventReferenceDate(event);
    assert.strictEqual(ref.getHours(), 14);
    assert.strictEqual(ref.getMinutes(), 30);
  });

  it("rejects past events and accepts future events", () => {
    const past = {
      information: { endDate: "2020-01-01", endTime: "18:00" },
    };
    const future = {
      information: { startDate: "2099-12-31", startTime: "10:00" },
    };

    assert.strictEqual(isEventBookable(past, new Date("2025-01-01")), false);
    assert.strictEqual(isEventBookable(future, new Date("2025-01-01")), true);
  });

  it("skips date check for non-ticket bookables", () => {
    assert.strictEqual(
      isTicketEventDateBookable({ type: "resource" }, null),
      true,
    );
    assert.strictEqual(
      isTicketEventDateBookable(
        { type: "ticket", eventId: "e1" },
        null,
        new Date(),
      ),
      false,
    );
  });

  it("checks event seat capacity against max attendees", () => {
    const eventBookings = [
      {
        bookableItems: [
          {
            amount: 3,
            _bookableUsed: { eventId: "e1", tenantId: "t1" },
          },
          {
            amount: 2,
            _bookableUsed: { eventId: "e2", tenantId: "t1" },
          },
        ],
      },
      {
        bookableItems: [
          {
            amount: 4,
            _bookableUsed: { eventId: "e1", tenantId: "t1" },
          },
        ],
      },
    ];

    const fits = hasEventSeats(eventBookings, "e1", "t1", 1, 10);
    assert.strictEqual(fits.available, true);
    assert.strictEqual(fits.amountBooked, 7);

    const full = hasEventSeats(eventBookings, "e1", "t1", 4, 10);
    assert.strictEqual(full.available, false);
    assert.strictEqual(full.remaining, 3);
  });
});

describe("availability rules R1 — duration-rules", () => {
  const bookable = {
    isScheduleRelated: true,
    minBookingDuration: 2,
    maxBookingDuration: 8,
  };

  it("allows any duration for non-schedule-related bookables", () => {
    assert.strictEqual(
      isDurationAllowed({ isScheduleRelated: false }, 0, 30 * 60 * 1000),
      true,
    );
  });

  it("rejects bookings shorter than minBookingDuration", () => {
    const oneHour = 60 * 60 * 1000;
    assert.strictEqual(isDurationAllowed(bookable, 0, oneHour), false);
    assert.strictEqual(getBookingDurationHours(0, 3 * oneHour), 3);
  });

  it("rejects bookings longer than maxBookingDuration", () => {
    const oneHour = 60 * 60 * 1000;
    assert.strictEqual(isDurationAllowed(bookable, 0, 10 * oneHour), false);
    assert.strictEqual(isDurationAllowed(bookable, 0, 4 * oneHour), true);
  });
});

describe("availability rules R1 — permission-rules", () => {
  it("requires isBookable flag", () => {
    assert.strictEqual(isBookableEnabled({ isBookable: true }), true);
    assert.strictEqual(isBookableEnabled({ isBookable: false }), false);
    assert.strictEqual(isBookableEnabled(null), false);
  });

  it("allows all users when no permit list is configured", () => {
    assert.strictEqual(isUserPermitted("user-1", []), true);
    assert.strictEqual(isUserPermitted(undefined, []), true);
  });

  it("checks user against resolved permit list", () => {
    const permitted = ["user-a", "user-b"];
    assert.strictEqual(isUserPermitted("user-a", permitted), true);
    assert.strictEqual(isUserPermitted("user-c", permitted), false);
    assert.strictEqual(
      hasBookingPermissionSync(
        { isBookable: true },
        "user-a",
        permitted,
      ),
      true,
    );
    assert.strictEqual(
      hasBookingPermissionSync(
        { isBookable: false },
        "user-a",
        permitted,
      ),
      false,
    );
  });
});
