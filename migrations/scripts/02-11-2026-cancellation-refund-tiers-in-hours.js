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
    // Read and written through the driver: the Tenant schema no longer knows
    // `daysBeforeStart` and would drop it.
    const tenants = mongoose.model("Tenant").collection;
    const withHours = await tenants
      .find(
        { "cancellationRefundTiers.hoursBeforeStart": { $exists: true } },
        { projection: { cancellationRefundTiers: 1 } },
      )
      .toArray();

    const operations = withHours.map((tenant) => ({
      updateOne: {
        filter: { _id: tenant._id },
        update: {
          $set: {
            cancellationRefundTiers: tiersInDays(
              tenant.cancellationRefundTiers,
            ),
          },
        },
      },
    }));
    if (operations.length > 0) {
      await tenants.bulkWrite(operations);
    }
  },
};

/**
 * A tier of hours that are no whole days falls to the day below. Where two
 * tiers fall to the same day, the one with the most hours stays, so the days
 * stay unique and the percentages keep falling.
 */
function tiersInDays(tiers) {
  const hoursOf = (tier) => tier.hoursBeforeStart ?? tier.daysBeforeStart * 24;
  const byDay = new Map();
  for (const tier of [...tiers].sort((a, b) => hoursOf(b) - hoursOf(a))) {
    const daysBeforeStart =
      tier.daysBeforeStart ?? Math.floor(tier.hoursBeforeStart / 24);
    if (!byDay.has(daysBeforeStart)) {
      byDay.set(daysBeforeStart, {
        daysBeforeStart,
        refundPercentage: tier.refundPercentage,
      });
    }
  }
  return [...byDay.values()];
}
