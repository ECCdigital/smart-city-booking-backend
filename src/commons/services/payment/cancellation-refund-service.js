const { BadRequestError } = require("../../../errors/BaseError");
const {
  normalizeCancellationRefundTiers,
} = require("../../utilities/cancellation-refund-tiers");
const { STATUS } = require("../booking-lifecycle/booking-state");

const CANCELLATION_ORIGINS = Object.freeze({
  USER: "user",
  ADMIN: "admin",
  SYSTEM: "system",
});

const MS_PER_HOUR = 60 * 60 * 1000;
const HOURS_PER_DAY = 24;

/**
 * The refund state of a cancelled booking (glossary "Erstattungsstand"):
 * whether the administration has paid the refund out. Kept at the booking's
 * refund audit, set by hand; the platform pays nothing out itself.
 */
const REFUND_STATE = Object.freeze({
  OPEN: "open",
  COMPLETED: "completed",
});

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

    const { hoursBeforeStart, appliedTierHours, suggestedRefundPercentage } =
      this.resolvePolicy({
        tiers: tenant?.cancellationRefundTiers || [],
        withoutTimeSpanPercentage:
          tenant?.cancellationRefundPercentageWithoutTimeSpan,
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
      hoursBeforeStart,
      originalAmountEur: originalAmountCents / 100,
      suggestedRefundPercentage,
      appliedRefundPercentage,
      refundAmountEur: refundAmountCents / 100,
      cancellationFeeEur: cancellationFeeCents / 100,
      appliedTierHours,
      origin,
      adminOverride:
        origin === CANCELLATION_ORIGINS.ADMIN &&
        appliedRefundPercentage !== suggestedRefundPercentage,
      cancelledByUserId: cancelledByUserId || null,
    };
  }

  /**
   * Whether a cancellation leaves a refund to pay out (glossary
   * "Erstattungsstand"): the booking was confirmed - so a priced one was
   * paid - and the calculation refunds an amount.
   *
   * @param {Object} calculation What `calculate` answered
   * @param {string} cancelledFrom The state the booking is cancelled from
   * @returns {boolean}
   */
  static isRefundDue(calculation, cancelledFrom) {
    return (
      cancelledFrom === STATUS.CONFIRMED &&
      (Number(calculation?.refundAmountEur) || 0) > 0
    );
  }

  /**
   * The refund audit a booking carries from its cancellation on: the
   * calculation, the state it was cancelled from where it is cancelled
   * (glossary "Wiederherstellung" returns to it; a rejected request has
   * none) or withdrawn, and the open refund state where a refund is due.
   *
   * @param {Object} calculation What `calculate` answered
   * @param {{ status: string, cancelledFrom: string }} transition The state
   *   the cancellation lands on and the one it comes from
   * @returns {Object} The audit to store as `booking.cancellationRefund`
   */
  static toBookingAudit(calculation, { status, cancelledFrom }) {
    return {
      ...calculation,
      ...((status === STATUS.CANCELLED || status === STATUS.WITHDRAWN) && {
        cancelledFrom,
      }),
      ...(this.isRefundDue(calculation, cancelledFrom) && {
        refundState: REFUND_STATE.OPEN,
      }),
    };
  }

  /**
   * @param {*} refundState The value a request names as refund state
   * @throws {BadRequestError} `invalid_refund_state` unless it is one
   */
  static validateRefundState(refundState) {
    if (!Object.values(REFUND_STATE).includes(refundState)) {
      throw new BadRequestError("invalid_refund_state", { refundState });
    }
  }

  /**
   * The tier that applies to the cancellation and its refund. A booking
   * without a time span falls under no tier: it gets the tenant's
   * `withoutTimeSpanPercentage`, 100 where the tenant names none.
   */
  static resolvePolicy({
    tiers,
    withoutTimeSpanPercentage,
    timeBegin,
    cancelledAt,
  }) {
    const normalizedTiers = normalizeCancellationRefundTiers(tiers || []);
    const hoursBeforeStart = this.calculateHoursBeforeStart(
      timeBegin,
      cancelledAt,
    );

    if (hoursBeforeStart === null) {
      return {
        hoursBeforeStart,
        appliedTierHours: null,
        suggestedRefundPercentage: withoutTimeSpanPercentage ?? 100,
      };
    }

    if (normalizedTiers.length === 0) {
      return {
        hoursBeforeStart,
        appliedTierHours: null,
        suggestedRefundPercentage: 100,
      };
    }

    const appliedTier =
      normalizedTiers.find(
        (tier) => hoursBeforeStart >= tier.hoursBeforeStart,
      ) || normalizedTiers[normalizedTiers.length - 1];

    return {
      hoursBeforeStart,
      appliedTierHours: appliedTier.hoursBeforeStart,
      suggestedRefundPercentage: appliedTier.refundPercentage,
    };
  }

  /**
   * The whole hours that pass from the cancellation to the start of the
   * booking, rounded down; negative once it has begun. Counted on the elapsed
   * time, so a change to or from summer time shifts nothing. `null` for a
   * booking without a time span (`Number(null)` would read it as 01.01.1970).
   */
  static calculateHoursBeforeStart(timeBegin, cancelledAt) {
    if (timeBegin === null || timeBegin === undefined || timeBegin === "") {
      return null;
    }
    const beginMs = Number(timeBegin);
    const cancelledMs = Number(cancelledAt);
    if (!Number.isFinite(beginMs) || !Number.isFinite(cancelledMs)) {
      return null;
    }

    return Math.floor((beginMs - cancelledMs) / MS_PER_HOUR);
  }

  /**
   * The time from the cancellation to the start of a calculation as it is
   * read: whole days of 24 hours from one day on, hours below. An audit of
   * before 4.4 counted calendar days (`daysBeforeStart`) and keeps them.
   *
   * @param {Object} calculation A calculation, preview or stored audit
   * @returns {{ hoursBeforeStart: number|null, daysBeforeStart: number|null, label: string|null }}
   *   `daysBeforeStart` in whole days of 24 hours; `label` such as
   *   "13 Stunden" or "2 Tage", `null` without a time span
   */
  static describeTimeBeforeStart(calculation) {
    const hours = calculation?.hoursBeforeStart;
    if (Number.isFinite(hours)) {
      const days = Math.floor(hours / HOURS_PER_DAY);
      return {
        hoursBeforeStart: hours,
        daysBeforeStart: days,
        label:
          hours >= HOURS_PER_DAY
            ? formatDays(days)
            : `${hours} ${hours === 1 ? "Stunde" : "Stunden"}`,
      };
    }

    const legacyDays = calculation?.daysBeforeStart;
    if (Number.isFinite(legacyDays)) {
      return {
        hoursBeforeStart: null,
        daysBeforeStart: legacyDays,
        label: formatDays(legacyDays),
      };
    }

    return { hoursBeforeStart: null, daysBeforeStart: null, label: null };
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

  /**
   * The refund calculation as the customer sees it (the preview endpoints,
   * the verification mail of a cancellation request): the amounts and the
   * percentages, none of the audit fields.
   *
   * @param {Object} calculation What `calculate` answered
   * @param {string} bookingId
   * @returns {Object} The customer's preview
   */
  static toCustomerPreview(calculation, bookingId) {
    return {
      bookingId,
      originalAmountEur: calculation.originalAmountEur,
      refundAmountEur: calculation.refundAmountEur,
      cancellationFeeEur: calculation.cancellationFeeEur,
      suggestedRefundPercentage: calculation.suggestedRefundPercentage,
      appliedRefundPercentage: calculation.appliedRefundPercentage,
      hoursBeforeStart: calculation.hoursBeforeStart,
      appliedTierHours: calculation.appliedTierHours,
    };
  }

  /**
   * Build Handlebars-friendly refund fields for cancellation mails.
   * Accepts a full calculation or a customer preview object.
   */
  static toMailTemplateData(calculation) {
    if (!calculation || typeof calculation !== "object") {
      return {
        hasRefundPreview: false,
        originalAmountEur: 0,
        refundAmountEur: 0,
        cancellationFeeEur: 0,
        refundPercentage: 0,
        hoursBeforeStart: null,
        daysBeforeStart: null,
        timeBeforeStartLabel: null,
        hasCancellationFee: false,
      };
    }

    const originalAmountEur = Number(calculation.originalAmountEur) || 0;
    const refundAmountEur = Number(calculation.refundAmountEur) || 0;
    const cancellationFeeEur = Number(calculation.cancellationFeeEur) || 0;
    const refundPercentage = Number(
      calculation.appliedRefundPercentage ??
        calculation.suggestedRefundPercentage ??
        0,
    );
    const timeBeforeStart = this.describeTimeBeforeStart(calculation);

    return {
      hasRefundPreview: originalAmountEur > 0,
      originalAmountEur,
      refundAmountEur,
      cancellationFeeEur,
      refundPercentage,
      hoursBeforeStart: timeBeforeStart.hoursBeforeStart,
      daysBeforeStart: timeBeforeStart.daysBeforeStart,
      timeBeforeStartLabel: timeBeforeStart.label,
      hasCancellationFee: cancellationFeeEur > 0,
    };
  }
}

function formatDays(days) {
  return `${days} ${days === 1 ? "Tag" : "Tage"}`;
}

/**
 * The bank details of a refund as they are stored and printed: trimmed,
 * IBAN and BIC without spaces and upper-cased; `null` where nothing is
 * given.
 *
 * @param {Object} [bankDetails]
 * @returns {{ accountHolder: string, bankName: string, iban: string, bic: string }|null}
 */
function sanitizeBankDetails(bankDetails) {
  if (!bankDetails || typeof bankDetails !== "object") {
    return null;
  }

  const toTrimmedString = (value) =>
    typeof value === "string" ? value.trim() : "";

  const accountHolder = toTrimmedString(bankDetails.accountHolder);
  const bankName = toTrimmedString(bankDetails.bankName);
  const iban = toTrimmedString(bankDetails.iban)
    .replace(/\s+/g, "")
    .toUpperCase();
  const bic = toTrimmedString(bankDetails.bic)
    .replace(/\s+/g, "")
    .toUpperCase();

  if (!accountHolder && !bankName && !iban && !bic) {
    return null;
  }

  return { accountHolder, bankName, iban, bic };
}

/**
 * The bank details a cancellation keeps (glossary "Storno"): sanitized for
 * a paid booking - one cancelled from, or asked to be cancelled in,
 * `confirmed` - and `null` for an unpaid one, whatever was sent. The one
 * rule of the direct cancellation, the cancellation request and the
 * rejection, of a single booking and a group.
 *
 * @param {Object|null} [bankDetails]
 * @param {string} status The state the booking is cancelled from
 * @returns {{ accountHolder: string, bankName: string, iban: string, bic: string }|null}
 */
function refundBankDetails(bankDetails, status) {
  return status === STATUS.CONFIRMED ? sanitizeBankDetails(bankDetails) : null;
}

module.exports = {
  CancellationRefundService,
  CANCELLATION_ORIGINS,
  REFUND_STATE,
  refundBankDetails,
};
