/**
 * The refund scale of a tenant: each tier names its deadline in whole hours
 * before the start of the booking, `hoursBeforeStart`. The Admin UI enters it
 * in days or hours; a day is 24 hours.
 */
function getCancellationRefundTiersError(tiers) {
  if (!Array.isArray(tiers)) {
    return "cancellationRefundTiers must be an array";
  }

  const seenHours = new Set();
  for (const tier of tiers) {
    if (!tier || typeof tier !== "object" || Array.isArray(tier)) {
      return "Each cancellation refund tier must be an object";
    }

    if (!Number.isInteger(tier.hoursBeforeStart) || tier.hoursBeforeStart < 0) {
      return "hoursBeforeStart must be a non-negative integer";
    }

    if (
      !Number.isInteger(tier.refundPercentage) ||
      tier.refundPercentage < 0 ||
      tier.refundPercentage > 100
    ) {
      return "refundPercentage must be an integer between 0 and 100";
    }

    if (seenHours.has(tier.hoursBeforeStart)) {
      return "hoursBeforeStart must be unique";
    }
    seenHours.add(tier.hoursBeforeStart);
  }

  const sorted = [...tiers].sort(
    (left, right) => right.hoursBeforeStart - left.hoursBeforeStart,
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].refundPercentage > sorted[index - 1].refundPercentage) {
      return "refundPercentage must not decrease with more advance notice";
    }
  }

  return null;
}

/**
 * The refund of a booking without a time span: no tier of the scale applies
 * to it, so the tenant names one percentage of its own (default 100).
 */
function getRefundPercentageWithoutTimeSpanError(percentage) {
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
    return "cancellationRefundPercentageWithoutTimeSpan must be an integer between 0 and 100";
  }
  return null;
}

function normalizeCancellationRefundTiers(tiers) {
  const error = getCancellationRefundTiersError(tiers);
  if (error) {
    throw new Error(error);
  }

  return tiers
    .map(({ hoursBeforeStart, refundPercentage }) => ({
      hoursBeforeStart,
      refundPercentage,
    }))
    .sort((left, right) => right.hoursBeforeStart - left.hoursBeforeStart);
}

module.exports = {
  getCancellationRefundTiersError,
  getRefundPercentageWithoutTimeSpanError,
  normalizeCancellationRefundTiers,
};
