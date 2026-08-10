const BookingModel = require("./models/bookingModel");
const BookableModel = require("./models/bookableModel");
const EventModel = require("./models/eventModel");
const MembershipModel = require("./models/membershipModel");
const UserModel = require("./models/userModel");
const TenantModel = require("./models/tenantModel");
const {
  BOOKING_STATUS_I18N,
} = require("../services/booking/booking-status-keys");
const {
  isEventBookable,
} = require("../availability/availability-rules/event-rules");

const ALL_STATUS_KEYS = [
  BOOKING_STATUS_I18N.AWAITING_APPROVAL,
  BOOKING_STATUS_I18N.PAYMENT_EXPECTED,
  BOOKING_STATUS_I18N.PAID_COMPLETED,
  BOOKING_STATUS_I18N.CONFIRMED_WITHOUT_PAYMENT,
  BOOKING_STATUS_I18N.REJECTED,
];

const BERLIN_TZ = "Europe/Berlin";
const PERIOD_FORMAT = {
  day: "%Y-%m-%d",
  week: "%G-W%V",
  month: "%Y-%m",
  year: "%Y",
};

/**
 * Mongo match predicates for a booking status i18n key.
 * Mirrors resolveBookingStatusKey.
 */
function statusPredicate(statusKey) {
  switch (statusKey) {
    case BOOKING_STATUS_I18N.REJECTED:
      return { isRejected: true };
    case BOOKING_STATUS_I18N.AWAITING_APPROVAL:
      return { isRejected: { $ne: true }, isCommitted: { $ne: true } };
    case BOOKING_STATUS_I18N.PAYMENT_EXPECTED:
      return {
        isRejected: { $ne: true },
        isCommitted: true,
        isPayed: { $ne: true },
        priceEur: { $gt: 0 },
      };
    case BOOKING_STATUS_I18N.PAID_COMPLETED:
      return {
        isRejected: { $ne: true },
        isCommitted: true,
        isPayed: true,
        priceEur: { $gt: 0 },
      };
    case BOOKING_STATUS_I18N.CONFIRMED_WITHOUT_PAYMENT:
      return {
        isRejected: { $ne: true },
        isCommitted: true,
        priceEur: { $lte: 0 },
      };
    default:
      return null;
  }
}

/**
 * OR-match for one or more status keys. Empty/null → no status constraint.
 * @param {string[]|null|undefined} statusKeys
 */
function statusMatch(statusKeys) {
  if (!statusKeys || statusKeys.length === 0) {
    return {};
  }
  if (statusKeys.length === 1) {
    return statusPredicate(statusKeys[0]) || {};
  }
  const predicates = statusKeys
    .map((key) => statusPredicate(key))
    .filter(Boolean);
  if (!predicates.length) {
    return {};
  }
  return { $or: predicates };
}

function includesRejectedStatus(statusKeys) {
  return (
    !statusKeys ||
    statusKeys.length === 0 ||
    statusKeys.includes(BOOKING_STATUS_I18N.REJECTED)
  );
}

/**
 * Convert epoch-ms fields to Date for $dateToString.
 * BSON int is common for legacy `timePaid: 0`; $toDate alone rejects int→date.
 */
function epochMsToDateExpr(fieldRef) {
  return { $toDate: { $toLong: fieldRef } };
}

function periodKeyExpr(dateExpr, granularity) {
  return {
    $dateToString: {
      format: PERIOD_FORMAT[granularity],
      date: dateExpr,
      timezone: BERLIN_TZ,
    },
  };
}

function timeRangeMatch(field, fromMs, toMs) {
  const range = {};
  if (fromMs != null) {
    range.$gte = fromMs;
  }
  if (toMs != null) {
    range.$lte = toMs;
  }
  if (Object.keys(range).length === 0) {
    return {};
  }
  return { [field]: range };
}

function bookableIdMatch(bookableId) {
  if (!bookableId) {
    return {};
  }
  return { "bookableItems.bookableId": bookableId };
}

function tenantIdMatch(tenantIds) {
  if (!tenantIds || tenantIds.length === 0) {
    return { tenantId: { $in: [] } };
  }
  if (tenantIds.length === 1) {
    return { tenantId: tenantIds[0] };
  }
  return { tenantId: { $in: tenantIds } };
}

class DashboardManager {
  static getStatusKeys() {
    return ALL_STATUS_KEYS;
  }

  static isValidStatusKey(statusKey) {
    return ALL_STATUS_KEYS.includes(statusKey);
  }

  /**
   * @param {string[]} tenantIds
   * @returns {Promise<Map<string, number>>} tenantId → createdAt ms
   */
  static async getTenantCreatedAtMap(tenantIds) {
    const docs = await TenantModel.find(
      { id: { $in: tenantIds } },
      { id: 1, _id: 1 },
    ).lean();
    const map = new Map();
    for (const doc of docs) {
      const createdAt =
        doc._id && typeof doc._id.getTimestamp === "function"
          ? doc._id.getTimestamp().getTime()
          : 0;
      map.set(doc.id, createdAt);
    }
    return map;
  }

  static async countUsers() {
    return UserModel.countDocuments({});
  }

  /**
   * Active membership counts per tenant.
   * @param {string[]} tenantIds
   * @returns {Promise<Map<string, number>>}
   */
  static async countActiveMembershipsByTenant(tenantIds) {
    if (!tenantIds.length) {
      return new Map();
    }
    const rows = await MembershipModel.aggregate([
      {
        $match: {
          ...tenantIdMatch(tenantIds),
          status: "active",
        },
      },
      { $group: { _id: "$tenantId", count: { $sum: 1 } } },
    ]).exec();
    return new Map(rows.map((r) => [r._id, r.count]));
  }

  /**
   * Bookable stock per tenant. `bookables` = all docs; `bookableObjects` respects isBookableFilter.
   * @param {string[]} tenantIds
   * @param {boolean|null|undefined} isBookableFilter
   */
  static async countBookablesByTenant(tenantIds, isBookableFilter) {
    if (!tenantIds.length) {
      return new Map();
    }

    const objectCond =
      isBookableFilter === true
        ? { $cond: ["$isBookable", 1, 0] }
        : isBookableFilter === false
          ? { $cond: [{ $eq: ["$isBookable", false] }, 1, 0] }
          : { $cond: ["$isBookable", 1, 0] };

    const rows = await BookableModel.aggregate([
      { $match: tenantIdMatch(tenantIds) },
      {
        $group: {
          _id: "$tenantId",
          bookables: { $sum: 1 },
          bookableObjects: { $sum: objectCond },
        },
      },
    ]).exec();

    return new Map(
      rows.map((r) => [
        r._id,
        { bookables: r.bookables, bookableObjects: r.bookableObjects },
      ]),
    );
  }

  /**
   * @param {string[]} tenantIds
   * @returns {Promise<Map<string, number>>}
   */
  static async countEventsByTenant(tenantIds) {
    if (!tenantIds.length) {
      return new Map();
    }
    const rows = await EventModel.aggregate([
      { $match: tenantIdMatch(tenantIds) },
      { $group: { _id: "$tenantId", count: { $sum: 1 } } },
    ]).exec();
    return new Map(rows.map((r) => [r._id, r.count]));
  }

  /**
   * Active Event counts per tenant (now-snapshot via isEventBookable; ignores from/to).
   * @param {string[]} tenantIds
   * @param {Date} [now]
   * @returns {Promise<Map<string, number>>}
   */
  static async countActiveEventsByTenant(tenantIds, now = new Date()) {
    if (!tenantIds.length) {
      return new Map();
    }
    const docs = await EventModel.find(tenantIdMatch(tenantIds))
      .select({ tenantId: 1, information: 1 })
      .lean();
    const counts = new Map(tenantIds.map((id) => [id, 0]));
    for (const doc of docs) {
      if (!isEventBookable(doc, now)) {
        continue;
      }
      counts.set(doc.tenantId, (counts.get(doc.tenantId) || 0) + 1);
    }
    return counts;
  }

  /**
   * Booking counts and optional byStatus, filtered by timeCreated (+ status/bookableId).
   * @returns {Promise<Map<string, { bookings: number, byStatus: Object<string, number> }>>}
   */
  static async aggregateBookingCountsByTenant({
    tenantIds,
    fromMs,
    toMs,
    bookableId,
    statusKeys,
    includeByStatus,
  }) {
    if (!tenantIds.length) {
      return new Map();
    }

    const match = {
      ...tenantIdMatch(tenantIds),
      ...timeRangeMatch("timeCreated", fromMs, toMs),
      ...bookableIdMatch(bookableId),
      ...statusMatch(statusKeys),
    };

    const group = {
      _id: "$tenantId",
      bookings: { $sum: 1 },
    };

    if (includeByStatus) {
      group.awaiting = {
        $sum: {
          $cond: [
            {
              $and: [
                { $ne: ["$isRejected", true] },
                { $ne: ["$isCommitted", true] },
              ],
            },
            1,
            0,
          ],
        },
      };
      group.paymentExpected = {
        $sum: {
          $cond: [
            {
              $and: [
                { $ne: ["$isRejected", true] },
                { $eq: ["$isCommitted", true] },
                { $ne: ["$isPayed", true] },
                { $gt: ["$priceEur", 0] },
              ],
            },
            1,
            0,
          ],
        },
      };
      group.paidCompleted = {
        $sum: {
          $cond: [
            {
              $and: [
                { $ne: ["$isRejected", true] },
                { $eq: ["$isCommitted", true] },
                { $eq: ["$isPayed", true] },
                { $gt: ["$priceEur", 0] },
              ],
            },
            1,
            0,
          ],
        },
      };
      group.confirmedWithoutPayment = {
        $sum: {
          $cond: [
            {
              $and: [
                { $ne: ["$isRejected", true] },
                { $eq: ["$isCommitted", true] },
                { $lte: ["$priceEur", 0] },
              ],
            },
            1,
            0,
          ],
        },
      };
      group.rejected = {
        $sum: { $cond: [{ $eq: ["$isRejected", true] }, 1, 0] },
      };
    }

    const rows = await BookingModel.aggregate([
      { $match: match },
      { $group: group },
    ]).exec();

    const result = new Map();
    for (const row of rows) {
      const entry = { bookings: row.bookings };
      if (includeByStatus) {
        entry.byStatus = {
          [BOOKING_STATUS_I18N.AWAITING_APPROVAL]: row.awaiting || 0,
          [BOOKING_STATUS_I18N.PAYMENT_EXPECTED]: row.paymentExpected || 0,
          [BOOKING_STATUS_I18N.PAID_COMPLETED]: row.paidCompleted || 0,
          [BOOKING_STATUS_I18N.CONFIRMED_WITHOUT_PAYMENT]:
            row.confirmedWithoutPayment || 0,
          [BOOKING_STATUS_I18N.REJECTED]: row.rejected || 0,
        };
      }
      result.set(row._id, entry);
    }
    return result;
  }

  /**
   * Cancellation counts by tenant. Time axis: cancelledAt with timeCreated fallback.
   * Status filter applies when it includes rejected (or when absent).
   */
  static async aggregateCancellationsByTenant({
    tenantIds,
    fromMs,
    toMs,
    bookableId,
    statusKeys,
  }) {
    if (!tenantIds.length) {
      return new Map();
    }

    // Cancellations are rejected bookings. If status filter omits rejected,
    // cancellations are zero for booking-side consistency.
    if (!includesRejectedStatus(statusKeys)) {
      return new Map(tenantIds.map((id) => [id, 0]));
    }

    const match = {
      ...tenantIdMatch(tenantIds),
      isRejected: true,
      ...bookableIdMatch(bookableId),
    };

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          _cancellationAt: {
            $ifNull: ["$cancellationRefund.cancelledAt", "$timeCreated"],
          },
        },
      },
    ];

    if (fromMs != null || toMs != null) {
      const range = {};
      if (fromMs != null) {
        range.$gte = fromMs;
      }
      if (toMs != null) {
        range.$lte = toMs;
      }
      pipeline.push({ $match: { _cancellationAt: range } });
    }

    pipeline.push({
      $group: { _id: "$tenantId", cancellations: { $sum: 1 } },
    });

    const rows = await BookingModel.aggregate(pipeline).exec();
    return new Map(rows.map((r) => [r._id, r.cancellations]));
  }

  /**
   * Revenue totals by tenant. Unaffected by status filter.
   * Uses timePaid + isPayed && !isRejected.
   */
  static async aggregateRevenueByTenant({
    tenantIds,
    fromMs,
    toMs,
    bookableId,
  }) {
    if (!tenantIds.length) {
      return new Map();
    }

    const match = {
      ...tenantIdMatch(tenantIds),
      isPayed: true,
      isRejected: false,
      ...timeRangeMatch("timePaid", fromMs, toMs),
      ...bookableIdMatch(bookableId),
    };

    const rows = await BookingModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$tenantId",
          revenueEur: { $sum: "$priceEur" },
        },
      },
    ]).exec();

    return new Map(rows.map((r) => [r._id, { revenueEur: r.revenueEur }]));
  }

  /**
   * Bookings grouped by Europe/Berlin period key (root series; not per-tenant).
   * @returns {Promise<Map<string, number>>} period → count
   */
  static async aggregateBookingsByPeriod({
    tenantIds,
    fromMs,
    toMs,
    bookableId,
    statusKeys,
    granularity,
  }) {
    if (!tenantIds.length || !granularity) {
      return new Map();
    }

    const match = {
      ...tenantIdMatch(tenantIds),
      ...timeRangeMatch("timeCreated", fromMs, toMs),
      ...bookableIdMatch(bookableId),
      ...statusMatch(statusKeys),
    };

    const rows = await BookingModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: periodKeyExpr(epochMsToDateExpr("$timeCreated"), granularity),
          bookings: { $sum: 1 },
        },
      },
    ]).exec();

    return new Map(rows.map((r) => [r._id, r.bookings]));
  }

  /**
   * Cancellations grouped by Europe/Berlin period key.
   * @returns {Promise<Map<string, number>>} period → count
   */
  static async aggregateCancellationsByPeriod({
    tenantIds,
    fromMs,
    toMs,
    bookableId,
    statusKeys,
    granularity,
  }) {
    if (!tenantIds.length || !granularity) {
      return new Map();
    }

    if (!includesRejectedStatus(statusKeys)) {
      return new Map();
    }

    const match = {
      ...tenantIdMatch(tenantIds),
      isRejected: true,
      ...bookableIdMatch(bookableId),
    };

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          _cancellationAt: {
            $ifNull: ["$cancellationRefund.cancelledAt", "$timeCreated"],
          },
        },
      },
    ];

    if (fromMs != null || toMs != null) {
      const range = {};
      if (fromMs != null) {
        range.$gte = fromMs;
      }
      if (toMs != null) {
        range.$lte = toMs;
      }
      pipeline.push({ $match: { _cancellationAt: range } });
    }

    pipeline.push({
      $group: {
        _id: periodKeyExpr(epochMsToDateExpr("$_cancellationAt"), granularity),
        cancellations: { $sum: 1 },
      },
    });

    const rows = await BookingModel.aggregate(pipeline).exec();
    return new Map(rows.map((r) => [r._id, r.cancellations]));
  }

  /**
   * Revenue grouped by Europe/Berlin period key. Unaffected by status filter.
   * @returns {Promise<Map<string, number>>} period → revenueEur
   */
  static async aggregateRevenueByPeriod({
    tenantIds,
    fromMs,
    toMs,
    bookableId,
    granularity,
  }) {
    if (!tenantIds.length || !granularity) {
      return new Map();
    }

    const match = {
      ...tenantIdMatch(tenantIds),
      isPayed: true,
      isRejected: false,
      ...timeRangeMatch("timePaid", fromMs, toMs),
      ...bookableIdMatch(bookableId),
    };

    const rows = await BookingModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: periodKeyExpr(epochMsToDateExpr("$timePaid"), granularity),
          revenueEur: { $sum: "$priceEur" },
        },
      },
    ]).exec();

    return new Map(rows.map((r) => [r._id, r.revenueEur]));
  }

  /**
   * Activity-only per-bookable bookings + cancellations for one tenant.
   * Returns unsorted rows (bookings/cancellations > 0). Caller applies limit.
   */
  static async aggregateByBookable({
    tenantId,
    fromMs,
    toMs,
    bookableId,
    statusKeys,
  }) {
    const bookingMatch = {
      tenantId,
      ...timeRangeMatch("timeCreated", fromMs, toMs),
      ...bookableIdMatch(bookableId),
      ...statusMatch(statusKeys),
    };

    const bookingRowsPromise = BookingModel.aggregate([
      { $match: bookingMatch },
      { $unwind: "$bookableItems" },
      ...(bookableId
        ? [{ $match: { "bookableItems.bookableId": bookableId } }]
        : []),
      {
        $group: {
          _id: "$bookableItems.bookableId",
          bookings: { $sum: 1 },
        },
      },
    ]).exec();

    let cancellationRowsPromise;
    if (!includesRejectedStatus(statusKeys)) {
      cancellationRowsPromise = Promise.resolve([]);
    } else {
      const cancelMatch = {
        tenantId,
        isRejected: true,
        ...bookableIdMatch(bookableId),
      };
      const cancelPipeline = [
        { $match: cancelMatch },
        {
          $addFields: {
            _cancellationAt: {
              $ifNull: ["$cancellationRefund.cancelledAt", "$timeCreated"],
            },
          },
        },
      ];
      if (fromMs != null || toMs != null) {
        const range = {};
        if (fromMs != null) {
          range.$gte = fromMs;
        }
        if (toMs != null) {
          range.$lte = toMs;
        }
        cancelPipeline.push({ $match: { _cancellationAt: range } });
      }
      cancelPipeline.push(
        { $unwind: "$bookableItems" },
        ...(bookableId
          ? [{ $match: { "bookableItems.bookableId": bookableId } }]
          : []),
        {
          $group: {
            _id: "$bookableItems.bookableId",
            cancellations: { $sum: 1 },
          },
        },
      );
      cancellationRowsPromise = BookingModel.aggregate(cancelPipeline).exec();
    }

    const [bookingRows, cancellationRows] = await Promise.all([
      bookingRowsPromise,
      cancellationRowsPromise,
    ]);

    const merged = new Map();
    for (const row of bookingRows) {
      if (!row._id) {
        continue;
      }
      merged.set(row._id, {
        bookableId: row._id,
        bookings: row.bookings,
        cancellations: 0,
      });
    }
    for (const row of cancellationRows) {
      if (!row._id) {
        continue;
      }
      const existing = merged.get(row._id);
      if (existing) {
        existing.cancellations = row.cancellations;
      } else {
        merged.set(row._id, {
          bookableId: row._id,
          bookings: 0,
          cancellations: row.cancellations,
        });
      }
    }

    const active = [...merged.values()].filter(
      (row) => row.bookings > 0 || row.cancellations > 0,
    );

    const ids = active.map((r) => r.bookableId);
    const titles = new Map();
    if (ids.length) {
      const bookables = await BookableModel.find(
        { tenantId, id: { $in: ids } },
        { id: 1, title: 1 },
      ).lean();
      for (const b of bookables) {
        titles.set(b.id, b.title);
      }
    }

    return active.map((row) => ({
      bookableId: row.bookableId,
      bookableTitle: titles.get(row.bookableId) || row.bookableId,
      bookings: row.bookings,
      cancellations: row.cancellations,
    }));
  }
}

module.exports = DashboardManager;
