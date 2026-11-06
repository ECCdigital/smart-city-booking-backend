const assert = require("assert");
const sinon = require("sinon");
const migration = require("../migrations/scripts/02-11-2026-cancellation-refund-tiers-in-hours");

describe("02-11-2026-cancellation-refund-tiers-in-hours migration", () => {
  afterEach(() => {
    sinon.restore();
  });

  function fakeMongoose(Tenant) {
    return { model: (name) => ({ Tenant })[name] };
  }

  it("converts only tenants whose tiers still name days, d days to d × 24 hours", async () => {
    const Tenant = {
      updateMany: sinon.stub().resolves({ modifiedCount: 1 }),
    };

    await migration.up(fakeMongoose(Tenant));

    const [filter, pipeline] = Tenant.updateMany.firstCall.args;
    assert.deepStrictEqual(filter, {
      "cancellationRefundTiers.daysBeforeStart": { $exists: true },
    });
    assert.deepStrictEqual(pipeline[0].$set.cancellationRefundTiers.$map.in, {
      hoursBeforeStart: {
        $ifNull: [
          "$$tier.hoursBeforeStart",
          { $multiply: ["$$tier.daysBeforeStart", 24] },
        ],
      },
      refundPercentage: "$$tier.refundPercentage",
    });
  });

  it("turns hours back into whole days on down", async () => {
    const Tenant = {
      updateMany: sinon.stub().resolves({ modifiedCount: 1 }),
    };

    await migration.down(fakeMongoose(Tenant));

    const [filter, pipeline] = Tenant.updateMany.firstCall.args;
    assert.deepStrictEqual(filter, {
      "cancellationRefundTiers.hoursBeforeStart": { $exists: true },
    });
    assert.deepStrictEqual(
      pipeline[0].$set.cancellationRefundTiers.$map.in.daysBeforeStart,
      {
        $ifNull: [
          "$$tier.daysBeforeStart",
          { $floor: { $divide: ["$$tier.hoursBeforeStart", 24] } },
        ],
      },
    );
  });

  it("is named after its file", () => {
    assert.strictEqual(
      migration.name,
      "02-11-2026-cancellation-refund-tiers-in-hours",
    );
  });
});
