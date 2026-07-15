const assert = require("assert");
const { DateTime } = require("luxon");
const {
  getCancellationRefundTiersError,
  normalizeCancellationRefundTiers,
} = require("../src/commons/utilities/cancellation-refund-tiers");
const {
  CancellationRefundService,
  CANCELLATION_ORIGINS,
} = require("../src/commons/services/payment/cancellation-refund-service");

const tiers = [
  { daysBeforeStart: 0, refundPercentage: 50 },
  { daysBeforeStart: 20, refundPercentage: 100 },
];

function berlinMillis(value) {
  return DateTime.fromISO(value, { zone: "Europe/Berlin" }).toMillis();
}

describe("cancellation refund tiers", function () {
  it("normalizes tiers by descending day threshold", function () {
    assert.deepStrictEqual(normalizeCancellationRefundTiers(tiers), [
      { daysBeforeStart: 20, refundPercentage: 100 },
      { daysBeforeStart: 0, refundPercentage: 50 },
    ]);
  });

  it("rejects duplicate thresholds and invalid percentages", function () {
    assert.match(
      getCancellationRefundTiersError([
        { daysBeforeStart: 5, refundPercentage: 100 },
        { daysBeforeStart: 5, refundPercentage: 50 },
      ]),
      /unique/,
    );
    assert.match(
      getCancellationRefundTiersError([
        { daysBeforeStart: 0, refundPercentage: 50.5 },
      ]),
      /integer between 0 and 100/,
    );
  });

  it("rejects refunds that decrease with more advance notice", function () {
    assert.match(
      getCancellationRefundTiersError([
        { daysBeforeStart: 20, refundPercentage: 50 },
        { daysBeforeStart: 0, refundPercentage: 100 },
      ]),
      /must not decrease/,
    );
  });
});

describe("CancellationRefundService", function () {
  it("defaults to a full refund without configured tiers", function () {
    const result = CancellationRefundService.calculate({
      tenant: {},
      booking: {
        priceEur: 42,
        timeBegin: berlinMillis("2026-08-10T10:00:00"),
      },
      cancelledAt: berlinMillis("2026-08-09T18:00:00"),
      origin: CANCELLATION_ORIGINS.USER,
    });

    assert.strictEqual(result.suggestedRefundPercentage, 100);
    assert.strictEqual(result.appliedRefundPercentage, 100);
    assert.strictEqual(result.refundAmountEur, 42);
  });

  it("uses calendar-day thresholds and freezes the lowest tier", function () {
    const tenant = { cancellationRefundTiers: tiers };
    const booking = {
      priceEur: 100,
      timeBegin: berlinMillis("2026-08-21T08:00:00"),
    };

    const twentyDays = CancellationRefundService.calculate({
      tenant,
      booking,
      cancelledAt: berlinMillis("2026-08-01T23:59:00"),
      origin: CANCELLATION_ORIGINS.USER,
    });
    const nineteenDays = CancellationRefundService.calculate({
      tenant,
      booking,
      cancelledAt: berlinMillis("2026-08-02T00:01:00"),
      origin: CANCELLATION_ORIGINS.USER,
    });
    const afterStart = CancellationRefundService.calculate({
      tenant,
      booking,
      cancelledAt: berlinMillis("2026-08-22T00:01:00"),
      origin: CANCELLATION_ORIGINS.USER,
    });

    assert.strictEqual(twentyDays.appliedRefundPercentage, 100);
    assert.strictEqual(nineteenDays.appliedRefundPercentage, 50);
    assert.strictEqual(afterStart.daysBeforeStart, -1);
    assert.strictEqual(afterStart.appliedRefundPercentage, 50);
  });

  it("calculates calendar days across the daylight-saving transition", function () {
    const days = CancellationRefundService.calculateDaysBeforeStart(
      berlinMillis("2026-03-30T00:01:00"),
      berlinMillis("2026-03-28T23:59:00"),
    );

    assert.strictEqual(days, 2);
  });

  it("coerces MongoDB Double timestamps before calculating days", function () {
    const { Double } = require("mongodb");
    const days = CancellationRefundService.calculateDaysBeforeStart(
      new Double(berlinMillis("2026-08-10T10:00:00")),
      berlinMillis("2026-08-09T18:00:00"),
    );

    assert.strictEqual(days, 1);
  });

  it("applies and audits an admin override using integer cents", function () {
    const result = CancellationRefundService.calculate({
      tenant: { cancellationRefundTiers: tiers },
      booking: {
        priceEur: 10.01,
        timeBegin: berlinMillis("2026-08-10T10:00:00"),
      },
      cancelledAt: berlinMillis("2026-08-09T10:00:00"),
      origin: CANCELLATION_ORIGINS.ADMIN,
      refundPercentage: 33,
      cancelledByUserId: "admin-1",
    });

    assert.strictEqual(result.suggestedRefundPercentage, 50);
    assert.strictEqual(result.appliedRefundPercentage, 33);
    assert.strictEqual(result.refundAmountEur, 3.3);
    assert.strictEqual(result.cancellationFeeEur, 6.71);
    assert.strictEqual(result.adminOverride, true);
    assert.strictEqual(result.cancelledByUserId, "admin-1");
  });

  it("ignores refund overrides for user cancellations", function () {
    const result = CancellationRefundService.calculate({
      tenant: { cancellationRefundTiers: tiers },
      booking: {
        priceEur: 100,
        timeBegin: berlinMillis("2026-08-10T10:00:00"),
      },
      cancelledAt: berlinMillis("2026-08-09T10:00:00"),
      origin: CANCELLATION_ORIGINS.USER,
      refundPercentage: 0,
    });

    assert.strictEqual(result.appliedRefundPercentage, 50);
    assert.strictEqual(result.refundAmountEur, 50);
  });

  it("keeps system cancellations at 100 percent", function () {
    const result = CancellationRefundService.calculate({
      tenant: { cancellationRefundTiers: tiers },
      booking: {
        priceEur: 100,
        timeBegin: berlinMillis("2026-08-10T10:00:00"),
      },
      cancelledAt: berlinMillis("2026-08-09T10:00:00"),
      origin: CANCELLATION_ORIGINS.SYSTEM,
    });

    assert.strictEqual(result.suggestedRefundPercentage, 50);
    assert.strictEqual(result.appliedRefundPercentage, 100);
    assert.strictEqual(result.refundAmountEur, 100);
  });

  it("rejects invalid admin refund percentages", function () {
    assert.doesNotThrow(() =>
      CancellationRefundService.validateRefundPercentage(0),
    );
    assert.doesNotThrow(() =>
      CancellationRefundService.validateRefundPercentage(100),
    );
    assert.throws(
      () => CancellationRefundService.validateRefundPercentage(50.5),
      (error) =>
        error.code === "invalid_refund_percentage" && error.statusCode === 400,
    );
  });
});
