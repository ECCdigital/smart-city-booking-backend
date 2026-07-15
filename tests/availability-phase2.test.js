const assert = require("assert");
const {
  computeCapacityIntervals,
  computeTicketParentCapacityIntervals,
} = require("../src/commons/services/availability/capacity-interval-calculator");
const {
  intersectAvailability,
  mergeAvailabilitySegments,
} = require("../src/commons/services/availability/availability-interval-merger");
const {
  combineAdjacentIntervals,
} = require("../src/commons/services/availability/availability-interval-utils");

describe("capacity-interval-calculator", () => {
  it("marks intervals unavailable when capacity is exceeded", () => {
    const bookings = [
      {
        id: "b1",
        isRejected: false,
        timeBegin: 1000,
        timeEnd: 4000,
        bookableItems: [{ bookableId: "room-a", amount: 2 }],
      },
    ];

    const intervals = computeCapacityIntervals({
      windowStart: 0,
      windowEnd: 5000,
      bookings,
      bookableId: "room-a",
      capacity: 3,
      requestedAmount: 2,
      mode: "additive",
      useTimeOverlap: true,
    });

    assert.deepStrictEqual(intervals, [
      { timeBegin: 0, timeEnd: 1000, available: true },
      { timeBegin: 1000, timeEnd: 4000, available: false },
      { timeBegin: 4000, timeEnd: 5000, available: true },
    ]);
  });

  it("uses exclusive mode for parent-style capacity checks", () => {
    const bookings = [
      {
        id: "b1",
        isRejected: false,
        timeBegin: 1000,
        timeEnd: 4000,
        bookableItems: [{ bookableId: "parent", amount: 1 }],
      },
    ];

    const intervals = computeCapacityIntervals({
      windowStart: 0,
      windowEnd: 5000,
      bookings,
      bookableId: "parent",
      capacity: 1,
      requestedAmount: 1,
      mode: "exclusive",
      useTimeOverlap: true,
    });

    assert.deepStrictEqual(intervals, [
      { timeBegin: 0, timeEnd: 1000, available: true },
      { timeBegin: 1000, timeEnd: 4000, available: false },
      { timeBegin: 4000, timeEnd: 5000, available: true },
    ]);
  });

  it("treats non-time-related bookings as covering the full window", () => {
    const bookings = [
      {
        id: "b1",
        isRejected: false,
        timeBegin: null,
        timeEnd: null,
        bookableItems: [{ bookableId: "locker", amount: 4 }],
      },
    ];

    const intervals = computeCapacityIntervals({
      windowStart: 0,
      windowEnd: 5000,
      bookings,
      bookableId: "locker",
      capacity: 5,
      requestedAmount: 1,
      mode: "additive",
      useTimeOverlap: false,
    });

    assert.deepStrictEqual(intervals, [
      { timeBegin: 0, timeEnd: 5000, available: true },
    ]);
  });

  it("marks non-time-related window unavailable when total capacity is exceeded", () => {
    const bookings = [
      {
        id: "b1",
        isRejected: false,
        timeBegin: null,
        timeEnd: null,
        bookableItems: [{ bookableId: "locker", amount: 4 }],
      },
    ];

    const intervals = computeCapacityIntervals({
      windowStart: 0,
      windowEnd: 5000,
      bookings,
      bookableId: "locker",
      capacity: 5,
      requestedAmount: 2,
      mode: "additive",
      useTimeOverlap: false,
    });

    assert.deepStrictEqual(intervals, [
      { timeBegin: 0, timeEnd: 5000, available: false },
    ]);
  });

  it("combines parent and child bookings for ticket parents", () => {
    const bookings = [
      {
        id: "b1",
        isRejected: false,
        timeBegin: 1000,
        timeEnd: 3000,
        bookableItems: [{ bookableId: "parent", amount: 1 }],
      },
      {
        id: "b2",
        isRejected: false,
        timeBegin: 2000,
        timeEnd: 4000,
        bookableItems: [{ bookableId: "child-ticket", amount: 2 }],
      },
    ];

    const intervals = computeTicketParentCapacityIntervals({
      windowStart: 0,
      windowEnd: 5000,
      bookings,
      parentBookable: { id: "parent", amount: 3 },
      relatedBookables: [{ id: "child-ticket" }],
      requestedAmount: 1,
      useTimeOverlap: true,
    });

    assert.deepStrictEqual(intervals, [
      { timeBegin: 0, timeEnd: 2000, available: true },
      { timeBegin: 2000, timeEnd: 3000, available: false },
      { timeBegin: 3000, timeEnd: 5000, available: true },
    ]);
  });
});

describe("availability-interval-merger", () => {
  it("intersects availability sets with AND semantics", () => {
    const a = [{ timeBegin: 0, timeEnd: 5000, available: true }];
    const b = [
      { timeBegin: 0, timeEnd: 2000, available: true },
      { timeBegin: 2000, timeEnd: 5000, available: false },
    ];

    const result = intersectAvailability([a, b]);
    assert.deepStrictEqual(result, [
      { timeBegin: 0, timeEnd: 2000, available: true },
      { timeBegin: 2000, timeEnd: 5000, available: false },
    ]);
  });

  it("lets unavailable segments win when merging overlaps", () => {
    const segments = [
      { timeBegin: 0, timeEnd: 3000, available: true },
      { timeBegin: 1000, timeEnd: 4000, available: false },
      { timeBegin: 3000, timeEnd: 5000, available: true },
    ];

    const result = mergeAvailabilitySegments(segments);
    assert.deepStrictEqual(result, [
      { timeBegin: 0, timeEnd: 1000, available: true },
      { timeBegin: 1000, timeEnd: 4000, available: false },
      { timeBegin: 4000, timeEnd: 5000, available: true },
    ]);
  });

  it("combines adjacent intervals with the same status", () => {
    const result = combineAdjacentIntervals([
      { timeBegin: 0, timeEnd: 1000, available: true },
      { timeBegin: 1000, timeEnd: 2000, available: true },
      { timeBegin: 2000, timeEnd: 3000, available: false },
    ]);

    assert.deepStrictEqual(result, [
      { timeBegin: 0, timeEnd: 2000, available: true },
      { timeBegin: 2000, timeEnd: 3000, available: false },
    ]);
  });
});
