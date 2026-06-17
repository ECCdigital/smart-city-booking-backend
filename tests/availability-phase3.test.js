const assert = require("assert");
const { isEventDateBookable } = require("../src/commons/availability/calendar-v2-context-checks");
const { getEventReferenceDate } = require("../src/commons/availability/availability-rules/event-rules");
const {
  applyBookingDurationRules,
  isBookingDurationAllowed,
} = require("../src/commons/services/availability/availability-duration-filter");
const {
  mergeAvailabilitySegments,
} = require("../src/commons/services/availability/availability-interval-merger");

describe("availability phase 3 rules", () => {
  it("rejects ticket bookables when the event is in the past", () => {
    const pastEvent = {
      information: {
        name: "Past Event",
        endDate: "2020-01-01",
        endTime: "18:00",
      },
    };

    const context = {
      bookable: { type: "ticket", eventId: "event-1" },
      event: pastEvent,
    };

    assert.strictEqual(isEventDateBookable(context), false);
  });

  it("accepts ticket bookables when the event is still upcoming", () => {
    const futureEvent = {
      information: {
        name: "Future Event",
        startDate: "2099-12-31",
        startTime: "18:00",
      },
    };

    const context = {
      bookable: { type: "ticket", eventId: "event-1" },
      event: futureEvent,
    };

    assert.strictEqual(isEventDateBookable(context), true);
    assert.ok(
      getEventReferenceDate(futureEvent).getFullYear() >= 2099,
    );
  });

  it("marks available segments shorter than minBookingDuration as unavailable", () => {
    const bookable = {
      isScheduleRelated: true,
      minBookingDuration: 2,
    };

    const segments = applyBookingDurationRules(
      [
        { timeBegin: 0, timeEnd: 60 * 60 * 1000, available: true },
        { timeBegin: 60 * 60 * 1000, timeEnd: 4 * 60 * 60 * 1000, available: true },
        { timeBegin: 4 * 60 * 60 * 1000, timeEnd: 5 * 60 * 60 * 1000, available: false },
      ],
      bookable,
    );

    assert.deepStrictEqual(segments, [
      { timeBegin: 0, timeEnd: 60 * 60 * 1000, available: false },
      { timeBegin: 60 * 60 * 1000, timeEnd: 4 * 60 * 60 * 1000, available: true },
      { timeBegin: 4 * 60 * 60 * 1000, timeEnd: 5 * 60 * 60 * 1000, available: false },
    ]);
  });

  it("re-applies merge after duration filtering when integrated in the pipeline shape", () => {
    const bookable = {
      isScheduleRelated: true,
      minBookingDuration: 2,
    };

    const segments = mergeAvailabilitySegments(
      applyBookingDurationRules(
        [
          { timeBegin: 0, timeEnd: 60 * 60 * 1000, available: true },
          { timeBegin: 60 * 60 * 1000, timeEnd: 5 * 60 * 60 * 1000, available: true },
        ],
        bookable,
      ),
    );

    assert.deepStrictEqual(segments, [
      { timeBegin: 0, timeEnd: 60 * 60 * 1000, available: false },
      { timeBegin: 60 * 60 * 1000, timeEnd: 5 * 60 * 60 * 1000, available: true },
    ]);
  });

  it("aligns duration validation with checkout semantics", () => {
    const bookable = {
      isScheduleRelated: true,
      minBookingDuration: 2,
      maxBookingDuration: 4,
    };

    assert.strictEqual(
      isBookingDurationAllowed(bookable, 0, 1 * 60 * 60 * 1000),
      false,
    );
    assert.strictEqual(
      isBookingDurationAllowed(bookable, 0, 3 * 60 * 60 * 1000),
      true,
    );
    assert.strictEqual(
      isBookingDurationAllowed(bookable, 0, 5 * 60 * 60 * 1000),
      false,
    );
  });
});
