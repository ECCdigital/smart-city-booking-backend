const assert = require("assert");

const {
  CancellationRefundService,
} = require("../src/commons/services/payment/cancellation-refund-service");

const parts = (calculation) =>
  CancellationRefundService.timeBeforeStartParts(calculation);

describe("CancellationRefundService.timeBeforeStartParts", function () {
  it("names hours below one day, days with their hours below three days", function () {
    assert.deepStrictEqual(parts({ hoursBeforeStart: 13 }), {
      days: 0,
      hours: 13,
    });
    assert.deepStrictEqual(parts({ hoursBeforeStart: 46 }), {
      days: 1,
      hours: 22,
    });
    assert.deepStrictEqual(parts({ hoursBeforeStart: 71 }), {
      days: 2,
      hours: 23,
    });
  });

  it("drops the hours from three days on", function () {
    assert.deepStrictEqual(parts({ hoursBeforeStart: 72 }), {
      days: 3,
      hours: 0,
    });
    assert.deepStrictEqual(parts({ hoursBeforeStart: 250 }), {
      days: 10,
      hours: 0,
    });
  });

  it("keeps the calendar days of an audit stored before 4.5", function () {
    assert.deepStrictEqual(parts({ daysBeforeStart: 4 }), {
      days: 4,
      hours: 0,
    });
  });

  it("answers null without a time span or once the booking has begun", function () {
    assert.strictEqual(parts({ hoursBeforeStart: null }), null);
    assert.strictEqual(parts({}), null);
    assert.strictEqual(parts({ hoursBeforeStart: -1 }), null);
  });

  it("follows the same rule as the German detailedLabel", function () {
    for (const hoursBeforeStart of [5, 24, 30, 46, 48, 71, 72, 100]) {
      const { days, hours } = parts({ hoursBeforeStart });
      const { detailedLabel } =
        CancellationRefundService.describeTimeBeforeStart({ hoursBeforeStart });
      const named = [
        days > 0 ? `${days} ${days === 1 ? "Tag" : "Tage"}` : null,
        hours > 0 || days === 0
          ? `${hours} ${hours === 1 ? "Stunde" : "Stunden"}`
          : null,
      ].filter(Boolean);
      assert.strictEqual(detailedLabel, named.join(" und "), hoursBeforeStart);
    }
  });
});
