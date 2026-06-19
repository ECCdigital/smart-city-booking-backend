const assert = require("assert");
const {
  buildBlockPeriodInstance,
  generateBlockPeriodInstances,
  generateBlockPeriodInstancesForDefinition,
  matchesBlockPeriodInstance,
} = require("../src/commons/utilities/block-period-generator");
const {
  periodHelpers: { generateTimePeriodsFromBlockPeriods },
} = require("../src/commons/services/calendar-service");

function localDate(isoDate, time = "00:00") {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

describe("block period generator", () => {
  const weekend = {
    id: "weekend",
    label: "Wochenende",
    startWeekday: 6,
    startTime: "08:00",
    endWeekday: 0,
    endTime: "20:00",
  };

  const workweek = {
    id: "workweek",
    label: "Arbeitswoche",
    startWeekday: 1,
    startTime: "08:00",
    endWeekday: 5,
    endTime: "18:00",
  };

  const longWeekend = {
    id: "long-weekend",
    label: "Verlängertes Wochenende",
    startWeekday: 5,
    startTime: "18:00",
    endWeekday: 1,
    endTime: "08:00",
  };

  it("builds a single weekend instance from an anchor date", () => {
    const instance = buildBlockPeriodInstance(
      weekend,
      localDate("2026-01-03"),
    );

    assert.strictEqual(instance.blockPeriodId, "weekend");
    assert.strictEqual(instance.label, "Wochenende");
    assert.strictEqual(instance.timeBegin, localDate("2026-01-03", "08:00").getTime());
    assert.strictEqual(instance.timeEnd, localDate("2026-01-04", "20:00").getTime());
  });

  it("builds a workweek instance spanning Monday to Friday", () => {
    const instance = buildBlockPeriodInstance(
      workweek,
      localDate("2026-01-05"),
    );

    assert.strictEqual(instance.timeBegin, localDate("2026-01-05", "08:00").getTime());
    assert.strictEqual(instance.timeEnd, localDate("2026-01-09", "18:00").getTime());
  });

  it("builds a block that crosses the week boundary", () => {
    const instance = buildBlockPeriodInstance(
      longWeekend,
      localDate("2026-01-09"),
    );

    assert.strictEqual(instance.timeBegin, localDate("2026-01-09", "18:00").getTime());
    assert.strictEqual(instance.timeEnd, localDate("2026-01-12", "08:00").getTime());
  });

  it("generates weekly weekend instances inside a range", () => {
    const instances = generateBlockPeriodInstancesForDefinition(
      weekend,
      localDate("2026-01-01"),
      localDate("2026-01-31"),
    );

    assert.strictEqual(instances.length, 4);
    assert.strictEqual(instances[0].timeBegin, localDate("2026-01-03", "08:00").getTime());
    assert.strictEqual(instances[1].timeBegin, localDate("2026-01-10", "08:00").getTime());
    assert.strictEqual(instances[2].timeBegin, localDate("2026-01-17", "08:00").getTime());
    assert.strictEqual(instances[3].timeBegin, localDate("2026-01-24", "08:00").getTime());
  });

  it("includes an ongoing block that started before the range", () => {
    const instances = generateBlockPeriodInstancesForDefinition(
      weekend,
      localDate("2026-01-04", "10:00"),
      localDate("2026-01-31"),
    );

    assert.strictEqual(instances[0].timeBegin, localDate("2026-01-03", "08:00").getTime());
    assert.strictEqual(instances[0].timeEnd, localDate("2026-01-04", "20:00").getTime());
  });

  it("generates instances for multiple block period definitions", () => {
    const instances = generateBlockPeriodInstances(
      localDate("2026-01-01"),
      localDate("2026-01-20"),
      [weekend, workweek],
    );

    const weekendInstances = instances.filter(
      (instance) => instance.blockPeriodId === "weekend",
    );
    const workweekInstances = instances.filter(
      (instance) => instance.blockPeriodId === "workweek",
    );

    assert.ok(weekendInstances.length >= 2);
    assert.ok(workweekInstances.length >= 2);
    assert.ok(
      instances.every(
        (instance, index, list) =>
          index === 0 || instance.timeBegin >= list[index - 1].timeBegin,
      ),
    );
  });

  it("matches an exact generated block instance", () => {
    const instances = generateBlockPeriodInstances(
      localDate("2026-01-01"),
      localDate("2026-01-31"),
      [weekend],
    );

    assert.strictEqual(
      matchesBlockPeriodInstance(
        instances[0].timeBegin,
        instances[0].timeEnd,
        [weekend],
      ),
      true,
    );
    assert.strictEqual(
      matchesBlockPeriodInstance(
        instances[0].timeBegin,
        instances[0].timeEnd - 60 * 60 * 1000,
        [weekend],
      ),
      false,
    );
  });
});

describe("generateTimePeriodsFromBlockPeriods", () => {
  it("returns calendar periods with metadata for block-period bookables", () => {
    const bookable = {
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
    };

    const periods = generateTimePeriodsFromBlockPeriods(
      localDate("2026-01-01"),
      localDate("2026-01-20"),
      bookable,
    );

    assert.ok(periods.length >= 2);
    assert.strictEqual(periods[0].available, true);
    assert.strictEqual(periods[0].blockPeriodId, "weekend");
    assert.strictEqual(periods[0].label, "Wochenende");
    assert.ok(periods[0].end > periods[0].start);
  });

  it("returns an empty list for non block-period bookables", () => {
    const periods = generateTimePeriodsFromBlockPeriods(
      localDate("2026-01-01"),
      localDate("2026-01-20"),
      { isScheduleRelated: true },
    );

    assert.deepStrictEqual(periods, []);
  });
});
