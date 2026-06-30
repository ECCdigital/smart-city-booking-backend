const assert = require("assert");
const {
  hasSufficientPreparationLeadTime,
  getEarliestBookableStart,
  generateLeadTimeBlockedPeriods,
  isLeadTimeConfigured,
} = require("../src/commons/availability/lead-time-calculator");

const SERVICE_HOURS = [
  {
    weekdays: [1, 2, 3, 4, 5],
    startTime: "08:00",
    endTime: "18:00",
  },
];

function bookable(overrides = {}) {
  return {
    isScheduleRelated: true,
    preparationLeadTimeMinutes: 120,
    serviceHours: SERVICE_HOURS,
    ...overrides,
  };
}

function at(isoString) {
  return new Date(isoString).getTime();
}

describe("lead-time-calculator", () => {
  it("treats unconfigured bookables as always allowed", () => {
    assert.strictEqual(
      isLeadTimeConfigured({ isScheduleRelated: true }),
      false,
    );
    assert.strictEqual(
      hasSufficientPreparationLeadTime(
        { isScheduleRelated: true },
        at("2026-06-15T10:00:00"),
      ),
      true,
    );
  });

  it("blocks Friday 18:00 to Monday 08:00", () => {
    const now = new Date("2026-06-12T18:00:00");
    const timeBegin = at("2026-06-15T08:00:00");

    assert.strictEqual(
      hasSufficientPreparationLeadTime(bookable(), timeBegin, now),
      false,
    );
  });

  it("allows Friday 18:00 to Monday 10:00", () => {
    const now = new Date("2026-06-12T18:00:00");
    const timeBegin = at("2026-06-15T10:00:00");

    assert.strictEqual(
      hasSufficientPreparationLeadTime(bookable(), timeBegin, now),
      true,
    );
  });

  it("allows same-day Monday 09:00 to 11:00", () => {
    const now = new Date("2026-06-15T09:00:00");
    const timeBegin = at("2026-06-15T11:00:00");

    assert.strictEqual(
      hasSufficientPreparationLeadTime(bookable(), timeBegin, now),
      true,
    );
  });

  it("blocks same-day Monday 17:30 to 18:30", () => {
    const now = new Date("2026-06-15T17:30:00");
    const timeBegin = at("2026-06-15T18:30:00");

    assert.strictEqual(
      hasSufficientPreparationLeadTime(bookable(), timeBegin, now),
      false,
    );
  });

  it("returns Monday 10:00 as earliest bookable start after Friday 18:00", () => {
    const now = new Date("2026-06-12T18:00:00");

    assert.strictEqual(
      getEarliestBookableStart(bookable(), now),
      at("2026-06-15T10:00:00"),
    );
  });

  it("returns Monday 11:00 as earliest start when booking same-day at 09:00", () => {
    const now = new Date("2026-06-15T09:00:00");

    assert.strictEqual(
      getEarliestBookableStart(bookable(), now),
      at("2026-06-15T11:00:00"),
    );
  });

  it("marks calendar periods before earliest start as unavailable", () => {
    const now = new Date("2026-06-12T18:00:00");
    const startDate = new Date("2026-06-15T00:00:00");
    const endDate = new Date("2026-06-15T23:59:59");
    const periods = generateLeadTimeBlockedPeriods(
      startDate,
      endDate,
      bookable(),
      now,
    );

    assert.deepStrictEqual(periods, [
      {
        start: startDate.getTime(),
        end: at("2026-06-15T10:00:00"),
      },
    ]);
  });

  it("marks the full queried range unavailable when no valid window exists", () => {
    const now = new Date("2026-06-12T18:00:00");
    const startDate = new Date("2026-06-15T00:00:00");
    const endDate = new Date("2026-06-15T23:59:59");
    const impossibleBookable = bookable({
      preparationLeadTimeMinutes: 600,
      serviceHours: [{ weekdays: [1], startTime: "08:00", endTime: "10:00" }],
    });

    assert.strictEqual(getEarliestBookableStart(impossibleBookable, now), null);
    assert.deepStrictEqual(
      generateLeadTimeBlockedPeriods(
        startDate,
        endDate,
        impossibleBookable,
        now,
      ),
      [{ start: startDate.getTime(), end: endDate.getTime() }],
    );
  });

  it("ignores lead time for non schedule-related bookables", () => {
    const configured = bookable({ isScheduleRelated: false });

    assert.strictEqual(isLeadTimeConfigured(configured), false);
    assert.strictEqual(
      hasSufficientPreparationLeadTime(
        configured,
        at("2026-06-15T08:00:00"),
        new Date("2026-06-12T18:00:00"),
      ),
      true,
    );
  });
});
