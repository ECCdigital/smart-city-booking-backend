const assert = require("assert");
const { DateTime } = require("luxon");
const {
  getCancellationRefundTiersError,
  getRefundPercentageWithoutTimeSpanError,
  normalizeCancellationRefundTiers,
} = require("../src/commons/utilities/cancellation-refund-tiers");
const {
  CancellationRefundService,
  CANCELLATION_ORIGINS,
} = require("../src/commons/services/payment/cancellation-refund-service");

const tiers = [
  { hoursBeforeStart: 0, refundPercentage: 50 },
  { hoursBeforeStart: 480, refundPercentage: 100 },
];

function berlinMillis(value) {
  return DateTime.fromISO(value, { zone: "Europe/Berlin" }).toMillis();
}

describe("cancellation refund tiers", function () {
  it("normalizes tiers by descending hour threshold", function () {
    assert.deepStrictEqual(normalizeCancellationRefundTiers(tiers), [
      { hoursBeforeStart: 480, refundPercentage: 100 },
      { hoursBeforeStart: 0, refundPercentage: 50 },
    ]);
  });

  it("rejects duplicate thresholds and invalid percentages", function () {
    assert.match(
      getCancellationRefundTiersError([
        { hoursBeforeStart: 24, refundPercentage: 100 },
        { hoursBeforeStart: 24, refundPercentage: 50 },
      ]),
      /unique/,
    );
    assert.match(
      getCancellationRefundTiersError([
        { hoursBeforeStart: 0, refundPercentage: 50.5 },
      ]),
      /integer between 0 and 100/,
    );
  });

  it("rejects refunds that decrease with more advance notice", function () {
    assert.match(
      getCancellationRefundTiersError([
        { hoursBeforeStart: 480, refundPercentage: 50 },
        { hoursBeforeStart: 0, refundPercentage: 100 },
      ]),
      /must not decrease/,
    );
  });

  it("rejects thresholds that are no whole, non-negative hours", function () {
    for (const hoursBeforeStart of [-1, 1.5, "12", undefined]) {
      assert.match(
        getCancellationRefundTiersError([
          { hoursBeforeStart, refundPercentage: 50 },
        ]),
        /hoursBeforeStart must be a non-negative integer/,
        String(hoursBeforeStart),
      );
    }
  });

  it("no longer takes a threshold in days", function () {
    assert.match(
      getCancellationRefundTiersError([
        { daysBeforeStart: 1, refundPercentage: 50 },
      ]),
      /hoursBeforeStart/,
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

  it("uses hour thresholds and freezes the lowest tier", function () {
    const tenant = { cancellationRefundTiers: tiers };
    const booking = {
      priceEur: 100,
      timeBegin: berlinMillis("2026-08-21T08:00:00"),
    };

    const twentyDays = CancellationRefundService.calculate({
      tenant,
      booking,
      cancelledAt: berlinMillis("2026-08-01T08:00:00"),
      origin: CANCELLATION_ORIGINS.USER,
    });
    const justUnderTwentyDays = CancellationRefundService.calculate({
      tenant,
      booking,
      cancelledAt: berlinMillis("2026-08-01T08:01:00"),
      origin: CANCELLATION_ORIGINS.USER,
    });
    const afterStart = CancellationRefundService.calculate({
      tenant,
      booking,
      cancelledAt: berlinMillis("2026-08-21T08:30:00"),
      origin: CANCELLATION_ORIGINS.USER,
    });

    assert.strictEqual(twentyDays.hoursBeforeStart, 480);
    assert.strictEqual(twentyDays.appliedTierHours, 480);
    assert.strictEqual(twentyDays.appliedRefundPercentage, 100);
    assert.strictEqual(justUnderTwentyDays.hoursBeforeStart, 479);
    assert.strictEqual(justUnderTwentyDays.appliedRefundPercentage, 50);
    assert.strictEqual(afterStart.hoursBeforeStart, -1);
    assert.strictEqual(afterStart.appliedRefundPercentage, 50);
  });

  it("refunds by the hours that pass until the start", function () {
    const tenant = {
      cancellationRefundTiers: [
        { hoursBeforeStart: 48, refundPercentage: 100 },
        { hoursBeforeStart: 12, refundPercentage: 50 },
        { hoursBeforeStart: 0, refundPercentage: 0 },
      ],
    };
    const booking = {
      priceEur: 100,
      timeBegin: berlinMillis("2026-08-21T09:00:00"),
    };
    const cases = [
      ["2026-08-20T20:00:00", 13, 50],
      ["2026-08-20T22:00:00", 11, 0],
      ["2026-08-19T10:00:00", 47, 50],
      ["2026-08-19T09:00:00", 48, 100],
    ];

    for (const [cancelledAt, hours, percentage] of cases) {
      const result = CancellationRefundService.calculate({
        tenant,
        booking,
        cancelledAt: berlinMillis(cancelledAt),
        origin: CANCELLATION_ORIGINS.USER,
      });

      assert.strictEqual(result.hoursBeforeStart, hours, cancelledAt);
      assert.strictEqual(
        result.appliedRefundPercentage,
        percentage,
        cancelledAt,
      );
    }
  });

  it("counts no days before the start of a booking without a time span and picks no tier", function () {
    const tenant = { cancellationRefundTiers: tiers };

    for (const timeBegin of [null, undefined, ""]) {
      const result = CancellationRefundService.calculate({
        tenant,
        booking: { priceEur: 100, timeBegin },
        cancelledAt: berlinMillis("2026-08-02T00:01:00"),
        origin: CANCELLATION_ORIGINS.USER,
      });

      assert.strictEqual(result.hoursBeforeStart, null, String(timeBegin));
      assert.strictEqual(result.appliedTierHours, null, String(timeBegin));
      assert.strictEqual(result.suggestedRefundPercentage, 100);
    }
  });

  it("refunds a booking without a time span by the tenant's own percentage", function () {
    for (const cancellationRefundTiers of [tiers, []]) {
      const result = CancellationRefundService.calculate({
        tenant: {
          cancellationRefundTiers,
          cancellationRefundPercentageWithoutTimeSpan: 40,
        },
        booking: { priceEur: 100, timeBegin: null },
        cancelledAt: berlinMillis("2026-08-02T00:01:00"),
        origin: CANCELLATION_ORIGINS.USER,
      });

      assert.strictEqual(result.appliedTierHours, null);
      assert.strictEqual(result.suggestedRefundPercentage, 40);
      assert.strictEqual(result.appliedRefundPercentage, 40);
      assert.strictEqual(result.refundAmountEur, 40);
      assert.strictEqual(result.cancellationFeeEur, 60);
    }
  });

  it("keeps the tiers for a booking with a time span when the tenant names a percentage without one", function () {
    const result = CancellationRefundService.calculate({
      tenant: {
        cancellationRefundTiers: [],
        cancellationRefundPercentageWithoutTimeSpan: 40,
      },
      booking: {
        priceEur: 100,
        timeBegin: berlinMillis("2026-08-22T10:00:00"),
      },
      cancelledAt: berlinMillis("2026-08-02T00:01:00"),
      origin: CANCELLATION_ORIGINS.USER,
    });

    assert.strictEqual(result.suggestedRefundPercentage, 100);
  });

  it("rejects a percentage without a time span outside 0 to 100 or not whole", function () {
    for (const percentage of [-1, 101, 12.5, "50", null]) {
      assert.notStrictEqual(
        getRefundPercentageWithoutTimeSpanError(percentage),
        null,
        String(percentage),
      );
    }
    for (const percentage of [0, 40, 100]) {
      assert.strictEqual(
        getRefundPercentageWithoutTimeSpanError(percentage),
        null,
      );
    }
  });

  it("counts the elapsed hours across the daylight-saving transitions", function () {
    // The night of 29.03.2026 lasts 23 hours, that of 25.10.2026 25 hours.
    assert.strictEqual(
      CancellationRefundService.calculateHoursBeforeStart(
        berlinMillis("2026-03-29T09:00:00"),
        berlinMillis("2026-03-28T20:00:00"),
      ),
      12,
    );
    assert.strictEqual(
      CancellationRefundService.calculateHoursBeforeStart(
        berlinMillis("2026-10-25T09:00:00"),
        berlinMillis("2026-10-24T20:00:00"),
      ),
      14,
    );
  });

  it("coerces MongoDB Double timestamps before calculating hours", function () {
    const { Double } = require("mongodb");
    const hours = CancellationRefundService.calculateHoursBeforeStart(
      new Double(berlinMillis("2026-08-10T10:00:00")),
      berlinMillis("2026-08-09T18:00:00"),
    );

    assert.strictEqual(hours, 16);
  });

  it("describes the time before the start in days from one day on, hours below", function () {
    const describe = (calculation) =>
      CancellationRefundService.describeTimeBeforeStart(calculation);

    assert.deepStrictEqual(describe({ hoursBeforeStart: 47 }), {
      hoursBeforeStart: 47,
      daysBeforeStart: 1,
      label: "1 Tag",
    });
    assert.deepStrictEqual(describe({ hoursBeforeStart: 48 }), {
      hoursBeforeStart: 48,
      daysBeforeStart: 2,
      label: "2 Tage",
    });
    assert.strictEqual(describe({ hoursBeforeStart: 13 }).label, "13 Stunden");
    assert.strictEqual(describe({ hoursBeforeStart: 1 }).label, "1 Stunde");
    assert.deepStrictEqual(describe({ daysBeforeStart: 3 }), {
      hoursBeforeStart: null,
      daysBeforeStart: 3,
      label: "3 Tage",
    });
    assert.deepStrictEqual(describe({ hoursBeforeStart: null }), {
      hoursBeforeStart: null,
      daysBeforeStart: null,
      label: null,
    });
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

  it("maps refund calculations to mail template variables", function () {
    const mailData = CancellationRefundService.toMailTemplateData({
      originalAmountEur: 100,
      refundAmountEur: 50,
      cancellationFeeEur: 50,
      appliedRefundPercentage: 50,
      daysBeforeStart: 7,
    });

    assert.strictEqual(mailData.hasRefundPreview, true);
    assert.strictEqual(mailData.refundPercentage, 50);
    assert.strictEqual(mailData.hasCancellationFee, true);
    assert.strictEqual(mailData.daysBeforeStart, 7);
  });

  it("marks zero-amount bookings as without refund preview", function () {
    const mailData = CancellationRefundService.toMailTemplateData({
      originalAmountEur: 0,
      refundAmountEur: 0,
      cancellationFeeEur: 0,
      suggestedRefundPercentage: 100,
    });

    assert.strictEqual(mailData.hasRefundPreview, false);
    assert.strictEqual(mailData.hasCancellationFee, false);
  });
});
