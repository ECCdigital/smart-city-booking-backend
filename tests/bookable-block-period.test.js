const assert = require("assert");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const {
  getBlockPeriodDayOffset,
  getBlockPeriodDurationMinutes,
  validateBlockPeriod,
  validateBookingModeExclusivity,
} = require("../src/commons/utilities/block-period-validation");
const { isTimeRelatedBookable } = require("../src/commons/availability/availability-rules/booking-amount");

function baseBookable(overrides = {}) {
  return {
    id: "bkbl-test",
    tenantId: "default",
    type: "room",
    title: "Test Room",
    ...overrides,
  };
}

describe("block period validation utilities", () => {
  it("calculates day offset within the same week", () => {
    assert.strictEqual(getBlockPeriodDayOffset(1, "08:00", 5, "18:00"), 4);
    assert.strictEqual(getBlockPeriodDayOffset(6, "08:00", 0, "20:00"), 1);
  });

  it("calculates day offset across a week boundary", () => {
    assert.strictEqual(getBlockPeriodDayOffset(5, "18:00", 1, "08:00"), 3);
  });

  it("wraps to the next week when end time is before start time on the same weekday", () => {
    assert.strictEqual(getBlockPeriodDayOffset(2, "22:00", 2, "06:00"), 7);
  });

  it("calculates duration in minutes for multi-day blocks", () => {
    assert.strictEqual(
      getBlockPeriodDurationMinutes(6, "08:00", 0, "20:00"),
      36 * 60,
    );
    assert.strictEqual(
      getBlockPeriodDurationMinutes(5, "18:00", 1, "08:00"),
      62 * 60,
    );
  });

  it("rejects zero-duration block periods", () => {
    assert.throws(
      () => validateBlockPeriod({
        id: "invalid",
        label: "Invalid",
        startWeekday: 1,
        startTime: "08:00",
        endWeekday: 1,
        endTime: "08:00",
      }),
      /duration greater than zero/,
    );
  });
});

describe("Bookable block period validation", () => {
  it("accepts a valid block-period bookable with multiple periods", () => {
    const bookable = Bookable.create(
      baseBookable({
        isBlockPeriodRelated: true,
        blockPeriods: [
          {
            id: "weekend",
            label: "Wochenende",
            startWeekday: 6,
            startTime: "08:00",
            endWeekday: 0,
            endTime: "20:00",
          },
          {
            id: "workweek",
            label: "Arbeitswoche",
            startWeekday: 1,
            startTime: "08:00",
            endWeekday: 5,
            endTime: "18:00",
          },
          {
            id: "long-weekend",
            label: "Verlängertes Wochenende",
            startWeekday: 5,
            startTime: "18:00",
            endWeekday: 1,
            endTime: "08:00",
          },
        ],
      }),
    );

    assert.strictEqual(bookable.isBlockPeriodRelated, true);
    assert.strictEqual(bookable.blockPeriods.length, 3);
  });

  it("requires at least one block period when isBlockPeriodRelated is true", () => {
    assert.throws(
      () =>
        Bookable.create(
          baseBookable({
            isBlockPeriodRelated: true,
            blockPeriods: [],
          }),
        ),
      /at least one entry/,
    );
  });

  it("rejects duplicate block period ids", () => {
    assert.throws(
      () =>
        Bookable.create(
          baseBookable({
            isBlockPeriodRelated: true,
            blockPeriods: [
              {
                id: "weekend",
                label: "Wochenende A",
                startWeekday: 6,
                startTime: "08:00",
                endWeekday: 0,
                endTime: "20:00",
              },
              {
                id: "weekend",
                label: "Wochenende B",
                startWeekday: 6,
                startTime: "10:00",
                endWeekday: 0,
                endTime: "18:00",
              },
            ],
          }),
        ),
      /duplicate id "weekend"/,
    );
  });

  it("rejects multiple active booking mode flags", () => {
    assert.throws(
      () =>
        validateBookingModeExclusivity({
          isScheduleRelated: true,
          isBlockPeriodRelated: true,
        }),
      /Only one booking mode flag may be true/,
    );

    assert.throws(
      () =>
        Bookable.create(
          baseBookable({
            isLongRange: true,
            isBlockPeriodRelated: true,
            blockPeriods: [
              {
                id: "weekend",
                label: "Wochenende",
                startWeekday: 6,
                startTime: "08:00",
                endWeekday: 0,
                endTime: "20:00",
              },
            ],
          }),
        ),
      /Only one booking mode flag may be true/,
    );
  });

  it("exports block period fields in public bookable data", () => {
    const bookable = Bookable.create(
      baseBookable({
        isBlockPeriodRelated: true,
        blockPeriods: [
          {
            id: "weekend",
            label: "Wochenende",
            startWeekday: 6,
            startTime: "08:00",
            endWeekday: 0,
            endTime: "20:00",
          },
        ],
      }),
    );

    const exported = bookable.exportPublic();

    assert.strictEqual(exported.isBlockPeriodRelated, true);
    assert.strictEqual(exported.blockPeriods.length, 1);
    assert.strictEqual(exported.blockPeriods[0].id, "weekend");
  });

  it("detects block-period bookables as time-related", () => {
    assert.strictEqual(
      isTimeRelatedBookable({ isBlockPeriodRelated: true }),
      true,
    );
  });
});
