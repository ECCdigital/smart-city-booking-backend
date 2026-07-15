const { DateTime } = require("luxon");
const { BadRequestError } = require("../../../errors/BaseError");
const {
  normalizeCancellationRefundTiers,
} = require("../../utilities/cancellation-refund-tiers");

const CANCELLATION_ORIGINS = Object.freeze({
  USER: "user",
  ADMIN: "admin",
  SYSTEM: "system",
});

const CANCELLATION_TIME_ZONE = "Europe/Berlin";

class CancellationRefundService {
  static calculate({
    tenant,
    booking,
    cancelledAt = Date.now(),
    origin,
    refundPercentage,
    cancelledByUserId = null,
  }) {
    if (!Object.values(CANCELLATION_ORIGINS).includes(origin)) {
      throw new BadRequestError("invalid_cancellation_origin", { origin });
    }

    if (!booking || !Number.isFinite(booking.priceEur)) {
      throw new BadRequestError("invalid_cancellation_booking");
    }

    if (!Number.isFinite(cancelledAt)) {
      throw new BadRequestError("invalid_cancellation_time");
    }

    const { daysBeforeStart, appliedTierDays, suggestedRefundPercentage } =
      this.resolvePolicy({
        tiers: tenant?.cancellationRefundTiers || [],
        timeBegin: booking.timeBegin,
        cancelledAt,
      });

    let appliedRefundPercentage = suggestedRefundPercentage;
    if (origin === CANCELLATION_ORIGINS.SYSTEM) {
      appliedRefundPercentage = 100;
    } else if (
      origin === CANCELLATION_ORIGINS.ADMIN &&
      refundPercentage !== undefined
    ) {
      this.validateRefundPercentage(refundPercentage);
      appliedRefundPercentage = refundPercentage;
    }

    const originalAmountCents = Math.round(booking.priceEur * 100);
    const refundAmountCents = Math.round(
      (originalAmountCents * appliedRefundPercentage) / 100,
    );
    const cancellationFeeCents = originalAmountCents - refundAmountCents;

    return {
      cancelledAt,
      daysBeforeStart,
      originalAmountEur: originalAmountCents / 100,
      suggestedRefundPercentage,
      appliedRefundPercentage,
      refundAmountEur: refundAmountCents / 100,
      cancellationFeeEur: cancellationFeeCents / 100,
      appliedTierDays,
      origin,
      adminOverride:
        origin === CANCELLATION_ORIGINS.ADMIN &&
        appliedRefundPercentage !== suggestedRefundPercentage,
      cancelledByUserId: cancelledByUserId || null,
    };
  }

  static resolvePolicy({ tiers, timeBegin, cancelledAt }) {
    const normalizedTiers = normalizeCancellationRefundTiers(tiers || []);
    const daysBeforeStart = this.calculateDaysBeforeStart(
      timeBegin,
      cancelledAt,
    );

    if (normalizedTiers.length === 0 || daysBeforeStart === null) {
      return {
        daysBeforeStart,
        appliedTierDays: null,
        suggestedRefundPercentage: 100,
      };
    }

    const appliedTier =
      normalizedTiers.find((tier) => daysBeforeStart >= tier.daysBeforeStart) ||
      normalizedTiers[normalizedTiers.length - 1];

    return {
      daysBeforeStart,
      appliedTierDays: appliedTier.daysBeforeStart,
      suggestedRefundPercentage: appliedTier.refundPercentage,
    };
  }

  static calculateDaysBeforeStart(timeBegin, cancelledAt) {
    const beginMs = Number(timeBegin);
    const cancelledMs = Number(cancelledAt);
    if (!Number.isFinite(beginMs) || !Number.isFinite(cancelledMs)) {
      return null;
    }

    const bookingDay = DateTime.fromMillis(beginMs, {
      zone: CANCELLATION_TIME_ZONE,
    }).startOf("day");
    const cancellationDay = DateTime.fromMillis(cancelledMs, {
      zone: CANCELLATION_TIME_ZONE,
    }).startOf("day");

    if (!bookingDay.isValid || !cancellationDay.isValid) {
      return null;
    }

    return Math.round(bookingDay.diff(cancellationDay, "days").days);
  }

  static validateRefundPercentage(refundPercentage) {
    if (
      !Number.isInteger(refundPercentage) ||
      refundPercentage < 0 ||
      refundPercentage > 100
    ) {
      throw new BadRequestError("invalid_refund_percentage", {
        refundPercentage,
      });
    }
  }
}

module.exports = {
  CancellationRefundService,
  CANCELLATION_ORIGINS,
  CANCELLATION_TIME_ZONE,
};
