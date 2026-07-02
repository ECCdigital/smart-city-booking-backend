const assert = require("assert");
const sinon = require("sinon");
const {
  runMinBookingLeadTimeCheck,
} = require("../src/commons/availability/checkout-availability-checks");
const {
  CHECK_TYPES,
} = require("../src/commons/availability/checkout-check-types");

const SERVICE_HOURS = [
  {
    weekdays: [1, 2, 3, 4, 5],
    startTime: "08:00",
    endTime: "18:00",
  },
];

function bookable(overrides = {}) {
  return {
    id: "room-1",
    title: "Meeting Room",
    isScheduleRelated: true,
    preparationLeadTimeMinutes: 120,
    serviceHours: SERVICE_HOURS,
    ...overrides,
  };
}

describe("runMinBookingLeadTimeCheck", () => {
  let clock;

  afterEach(() => {
    if (clock) {
      clock.restore();
      clock = null;
    }
  });

  it("passes when lead time is sufficient", async () => {
    clock = sinon.useFakeTimers(new Date("2026-06-15T09:00:00").getTime());

    const result = await runMinBookingLeadTimeCheck({
      originBookable: bookable(),
      timeBegin: new Date("2026-06-15T11:00:00").getTime(),
    });

    assert.deepStrictEqual(result, {
      checkType: CHECK_TYPES.INSUFFICIENT_LEAD_TIME,
      available: true,
    });
  });

  it("rejects when lead time is insufficient", async () => {
    clock = sinon.useFakeTimers(new Date("2026-06-12T18:00:00").getTime());

    await assert.rejects(
      () =>
        runMinBookingLeadTimeCheck({
          originBookable: bookable(),
          timeBegin: new Date("2026-06-15T08:00:00").getTime(),
        }),
      (error) => {
        assert.deepStrictEqual(error, {
          checkType: CHECK_TYPES.INSUFFICIENT_LEAD_TIME,
          available: false,
          message:
            "Die Buchung für das Objekt Meeting Room erfordert eine Vorbereitungszeit von 120 Minuten innerhalb der Servicezeiten.",
        });
        return true;
      },
    );
  });

  it("skips unconfigured bookables", async () => {
    const result = await runMinBookingLeadTimeCheck({
      originBookable: bookable({ preparationLeadTimeMinutes: null }),
      timeBegin: Date.now(),
    });

    assert.deepStrictEqual(result, {
      checkType: CHECK_TYPES.INSUFFICIENT_LEAD_TIME,
      available: true,
    });
  });

  it("passes for time-period-related bookables when lead time is sufficient", async () => {
    clock = sinon.useFakeTimers(new Date("2026-06-15T09:00:00").getTime());

    const result = await runMinBookingLeadTimeCheck({
      originBookable: bookable({
        isScheduleRelated: false,
        isTimePeriodRelated: true,
      }),
      timeBegin: new Date("2026-06-15T11:00:00").getTime(),
    });

    assert.deepStrictEqual(result, {
      checkType: CHECK_TYPES.INSUFFICIENT_LEAD_TIME,
      available: true,
    });
  });

  it("rejects time-period-related bookables when lead time is insufficient", async () => {
    clock = sinon.useFakeTimers(new Date("2026-06-15T09:30:00").getTime());

    await assert.rejects(
      () =>
        runMinBookingLeadTimeCheck({
          originBookable: bookable({
            isScheduleRelated: false,
            isTimePeriodRelated: true,
          }),
          timeBegin: new Date("2026-06-15T10:00:00").getTime(),
        }),
      (error) => {
        assert.strictEqual(error.checkType, CHECK_TYPES.INSUFFICIENT_LEAD_TIME);
        assert.strictEqual(error.available, false);
        return true;
      },
    );
  });

  it("passes for block-period-related bookables when lead time is sufficient", async () => {
    clock = sinon.useFakeTimers(new Date("2026-06-05T10:00:00").getTime());

    const result = await runMinBookingLeadTimeCheck({
      originBookable: bookable({
        isScheduleRelated: false,
        isBlockPeriodRelated: true,
      }),
      timeBegin: new Date("2026-06-06T08:00:00").getTime(),
    });

    assert.deepStrictEqual(result, {
      checkType: CHECK_TYPES.INSUFFICIENT_LEAD_TIME,
      available: true,
    });
  });

  it("rejects block-period-related bookables when lead time is insufficient", async () => {
    clock = sinon.useFakeTimers(new Date("2026-06-05T17:30:00").getTime());

    await assert.rejects(
      () =>
        runMinBookingLeadTimeCheck({
          originBookable: bookable({
            isScheduleRelated: false,
            isBlockPeriodRelated: true,
          }),
          timeBegin: new Date("2026-06-06T08:00:00").getTime(),
        }),
      (error) => {
        assert.strictEqual(error.checkType, CHECK_TYPES.INSUFFICIENT_LEAD_TIME);
        assert.strictEqual(error.available, false);
        return true;
      },
    );
  });
});
