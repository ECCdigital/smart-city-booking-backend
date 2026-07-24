function getCancellationRefundTiersError(tiers) {
  if (!Array.isArray(tiers)) {
    return "cancellationRefundTiers must be an array";
  }

  const seenDays = new Set();
  for (const tier of tiers) {
    if (!tier || typeof tier !== "object" || Array.isArray(tier)) {
      return "Each cancellation refund tier must be an object";
    }

    if (!Number.isInteger(tier.daysBeforeStart) || tier.daysBeforeStart < 0) {
      return "daysBeforeStart must be a non-negative integer";
    }

    if (
      !Number.isInteger(tier.refundPercentage) ||
      tier.refundPercentage < 0 ||
      tier.refundPercentage > 100
    ) {
      return "refundPercentage must be an integer between 0 and 100";
    }

    if (seenDays.has(tier.daysBeforeStart)) {
      return "daysBeforeStart must be unique";
    }
    seenDays.add(tier.daysBeforeStart);
  }

  const sorted = [...tiers].sort(
    (left, right) => right.daysBeforeStart - left.daysBeforeStart,
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].refundPercentage > sorted[index - 1].refundPercentage) {
      return "refundPercentage must not decrease with more advance notice";
    }
  }

  return null;
}

function normalizeCancellationRefundTiers(tiers) {
  const error = getCancellationRefundTiersError(tiers);
  if (error) {
    throw new Error(error);
  }

  return tiers
    .map(({ daysBeforeStart, refundPercentage }) => ({
      daysBeforeStart,
      refundPercentage,
    }))
    .sort((left, right) => right.daysBeforeStart - left.daysBeforeStart);
}

module.exports = {
  getCancellationRefundTiersError,
  normalizeCancellationRefundTiers,
};
