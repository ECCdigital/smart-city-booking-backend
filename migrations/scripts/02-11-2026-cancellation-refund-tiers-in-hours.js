/**
 * The tiers of a tenant's refund scale name their deadline in hours
 * (`hoursBeforeStart`) instead of calendar days (`daysBeforeStart`): d days
 * become d × 24 hours. Only tiers that still carry `daysBeforeStart` are
 * converted, so the migration can run again.
 */
module.exports = {
  name: "02-11-2026-cancellation-refund-tiers-in-hours",

  up: async function (mongoose) {
    const Tenant = mongoose.model("Tenant");

    await Tenant.updateMany(
      { "cancellationRefundTiers.daysBeforeStart": { $exists: true } },
      [
        {
          $set: {
            cancellationRefundTiers: {
              $map: {
                input: "$cancellationRefundTiers",
                as: "tier",
                in: {
                  hoursBeforeStart: {
                    $ifNull: [
                      "$$tier.hoursBeforeStart",
                      { $multiply: ["$$tier.daysBeforeStart", 24] },
                    ],
                  },
                  refundPercentage: "$$tier.refundPercentage",
                },
              },
            },
          },
        },
      ],
    );
  },

  down: async function (mongoose) {
    const Tenant = mongoose.model("Tenant");

    // A tier of hours that are no whole days falls to the day below.
    await Tenant.updateMany(
      { "cancellationRefundTiers.hoursBeforeStart": { $exists: true } },
      [
        {
          $set: {
            cancellationRefundTiers: {
              $map: {
                input: "$cancellationRefundTiers",
                as: "tier",
                in: {
                  daysBeforeStart: {
                    $ifNull: [
                      "$$tier.daysBeforeStart",
                      { $floor: { $divide: ["$$tier.hoursBeforeStart", 24] } },
                    ],
                  },
                  refundPercentage: "$$tier.refundPercentage",
                },
              },
            },
          },
        },
      ],
    );
  },
};
