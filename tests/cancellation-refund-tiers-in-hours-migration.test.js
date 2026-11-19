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

  function fakeCollection(tenants) {
    return {
      find: sinon.stub().returns({ toArray: sinon.stub().resolves(tenants) }),
      bulkWrite: sinon.stub().resolves({ modifiedCount: tenants.length }),
    };
  }

  function tiersWrittenBack(collection) {
    return collection.bulkWrite.firstCall.args[0].map(
      ({ updateOne }) => updateOne,
    );
  }

  it("turns hours back into whole days on down, only for tenants with hours", async () => {
    const collection = fakeCollection([
      {
        _id: "t1",
        cancellationRefundTiers: [
          { hoursBeforeStart: 480, refundPercentage: 100 },
          { hoursBeforeStart: 36, refundPercentage: 50 },
          { hoursBeforeStart: 0, refundPercentage: 0 },
        ],
      },
    ]);

    await migration.down(fakeMongoose({ collection }));

    assert.deepStrictEqual(collection.find.firstCall.args[0], {
      "cancellationRefundTiers.hoursBeforeStart": { $exists: true },
    });
    assert.deepStrictEqual(tiersWrittenBack(collection), [
      {
        filter: { _id: "t1" },
        update: {
          $set: {
            cancellationRefundTiers: [
              { daysBeforeStart: 20, refundPercentage: 100 },
              { daysBeforeStart: 1, refundPercentage: 50 },
              { daysBeforeStart: 0, refundPercentage: 0 },
            ],
          },
        },
      },
    ]);
  });

  it("keeps one tier per day on down, the one with the most hours", async () => {
    // 23 h and 12 h both fall to day 0, 36 h and 24 h both to day 1.
    const collection = fakeCollection([
      {
        _id: "t1",
        cancellationRefundTiers: [
          { hoursBeforeStart: 12, refundPercentage: 50 },
          { hoursBeforeStart: 23, refundPercentage: 80 },
        ],
      },
      {
        _id: "t2",
        cancellationRefundTiers: [
          { hoursBeforeStart: 24, refundPercentage: 40 },
          { hoursBeforeStart: 36, refundPercentage: 60 },
          { daysBeforeStart: 3, refundPercentage: 100 },
        ],
      },
    ]);

    await migration.down(fakeMongoose({ collection }));

    const [t1, t2] = tiersWrittenBack(collection);
    assert.deepStrictEqual(t1.update.$set.cancellationRefundTiers, [
      { daysBeforeStart: 0, refundPercentage: 80 },
    ]);
    assert.deepStrictEqual(t2.update.$set.cancellationRefundTiers, [
      { daysBeforeStart: 3, refundPercentage: 100 },
      { daysBeforeStart: 1, refundPercentage: 60 },
    ]);
  });

  it("writes nothing on down without tenants of hours", async () => {
    const collection = fakeCollection([]);

    await migration.down(fakeMongoose({ collection }));

    sinon.assert.notCalled(collection.bulkWrite);
  });

  it("is named after its file", () => {
    assert.strictEqual(
      migration.name,
      "02-11-2026-cancellation-refund-tiers-in-hours",
    );
  });
});
