const assert = require("assert");
const {
  getBookingBufferMs,
  isBookingBufferConfigured,
  overlapsBufferedInterval,
  expandBlockedInterval,
} = require("../src/commons/availability/booking-buffer");
const {
  evaluateCapacityIntervals,
} = require("../src/commons/availability/availability-rules/capacity-rules");
const BookingManager = require("../src/commons/data-managers/booking-manager");

describe("booking-buffer", () => {
  it("ignores buffer for non schedule-related bookables", () => {
    assert.deepStrictEqual(
      getBookingBufferMs({
        isScheduleRelated: false,
        bufferTimeAfterMinutes: 30,
      }),
      { beforeMs: 0, afterMs: 0 },
    );
    assert.strictEqual(
      isBookingBufferConfigured({
        isScheduleRelated: false,
        bufferTimeAfterMinutes: 30,
      }),
      false,
    );
  });

  it("expands blocked intervals like IFBS LocationBuffer", () => {
    const blocked = expandBlockedInterval(3_600_000, 7_200_000, 0, 1_800_000);
    assert.deepStrictEqual(blocked, {
      timeBegin: 3_600_000,
      timeEnd: 9_000_000,
    });
  });

  it("detects overlap when only the after-buffer collides", () => {
    assert.strictEqual(
      overlapsBufferedInterval(
        11 * 60 * 60 * 1000,
        12 * 60 * 60 * 1000,
        10 * 60 * 60 * 1000,
        11 * 60 * 60 * 1000,
        0,
        30 * 60 * 1000,
      ),
      true,
    );
    assert.strictEqual(
      overlapsBufferedInterval(
        11.5 * 60 * 60 * 1000,
        12.5 * 60 * 60 * 1000,
        10 * 60 * 60 * 1000,
        11 * 60 * 60 * 1000,
        0,
        30 * 60 * 1000,
      ),
      false,
    );
  });

  it("detects overlap when only the before-buffer collides", () => {
    assert.strictEqual(
      overlapsBufferedInterval(
        11 * 60 * 60 * 1000,
        12 * 60 * 60 * 1000,
        12 * 60 * 60 * 1000,
        13 * 60 * 60 * 1000,
        30 * 60 * 1000,
        0,
      ),
      true,
    );
  });
});

describe("capacity buffer intervals", () => {
  it("extends unavailable periods by after-buffer", () => {
    const bookings = [
      {
        id: "b1",
        isRejected: false,
        timeBegin: 10 * 60 * 60 * 1000,
        timeEnd: 11 * 60 * 60 * 1000,
        bookableItems: [{ bookableId: "room-a", amount: 1 }],
      },
    ];

    const intervals = evaluateCapacityIntervals({
      windowStart: 9 * 60 * 60 * 1000,
      windowEnd: 13 * 60 * 60 * 1000,
      bookings,
      bookableId: "room-a",
      capacity: 1,
      requestedAmount: 1,
      mode: "exclusive",
      useTimeOverlap: true,
      bufferBeforeMs: 0,
      bufferAfterMs: 30 * 60 * 1000,
    });

    assert.deepStrictEqual(intervals, [
      {
        timeBegin: 9 * 60 * 60 * 1000,
        timeEnd: 10 * 60 * 60 * 1000,
        available: true,
      },
      {
        timeBegin: 10 * 60 * 60 * 1000,
        timeEnd: 11.5 * 60 * 60 * 1000,
        available: false,
      },
      {
        timeBegin: 11.5 * 60 * 60 * 1000,
        timeEnd: 13 * 60 * 60 * 1000,
        available: true,
      },
    ]);
  });

  it("filters concurrent bookings with buffer-aware overlap", () => {
    const bookings = [
      {
        id: "b1",
        isRejected: false,
        timeBegin: 10 * 60 * 60 * 1000,
        timeEnd: 11 * 60 * 60 * 1000,
        bookableItems: [{ bookableId: "room-a", amount: 1 }],
      },
    ];

    const withoutBuffer = BookingManager.filterConcurrentBookings(
      bookings,
      11 * 60 * 60 * 1000,
      12 * 60 * 60 * 1000,
    );
    assert.deepStrictEqual(withoutBuffer, []);

    const withBuffer = BookingManager.filterConcurrentBookings(
      bookings,
      11 * 60 * 60 * 1000,
      12 * 60 * 60 * 1000,
      null,
      { beforeMs: 0, afterMs: 30 * 60 * 1000 },
    );
    assert.strictEqual(withBuffer.length, 1);
    assert.strictEqual(withBuffer[0].id, "b1");
  });
});
