const { v4: uuidv4 } = require("uuid");
const SupervisionNotificationModel = require("./models/supervisionNotificationModel");
const {
  NOTIFICATION_STATUS,
} = require("../services/supervision/supervision-constants");

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
/** A row as it is answered: without the store's own fields. */
const ROW_FIELDS = { _id: 0, __v: 0 };

/**
 * Data manager of the supervision notification outbox (glossary
 * "Mitteilungsanlass"): records an occasion, and keeps what the sender
 * (`supervision-notification-service.js`) learns about its delivery. A
 * row is never deleted and its occasion never rewritten.
 */
class SupervisionNotificationManager {
  /**
   * Records an occasion as a pending outbox row.
   *
   * @param {Object} occasion
   * @param {string} occasion.type One of `NOTIFICATION_TYPES`
   * @param {string} occasion.tenantId
   * @param {Object} [occasion.payload]
   * @param {Date} [occasion.createdAt] Default: now
   * @param {string} [occasion.dedupeKey]
   * @returns {Promise<Object>} The stored row as a plain object
   */
  static async record({ type, tenantId, payload = {}, createdAt, dedupeKey }) {
    const doc = new SupervisionNotificationModel({
      id: uuidv4(),
      type,
      tenantId,
      payload,
      status: NOTIFICATION_STATUS.PENDING,
      attempts: 0,
      createdAt: createdAt ?? new Date(),
      dedupeKey,
    });
    await doc.save();
    return doc.toObject();
  }

  /**
   * @param {string} id
   * @returns {Promise<Object|null>} The row, or null for an unknown id
   */
  static async get(id) {
    return SupervisionNotificationModel.findOne({ id }, ROW_FIELDS).lean();
  }

  /**
   * Claims a row for one dispatch: only a row not sent yet and not under
   * the lease of another dispatch is answered, with the lease taken and
   * the attempt counted - in one conditional write, so of two dispatches
   * of the same row one gets null.
   *
   * @param {string} id
   * @param {Object} options
   * @param {Date} options.now
   * @param {number} options.leaseMs After this long a lease has expired
   *   (the process that held it is gone)
   * @returns {Promise<Object|null>} The claimed row, or null
   */
  static async claimForDispatch(id, { now, leaseMs }) {
    return SupervisionNotificationModel.findOneAndUpdate(
      {
        id,
        status: { $ne: NOTIFICATION_STATUS.SENT },
        $or: [
          { dispatchingSince: null },
          { dispatchingSince: { $lt: new Date(now.getTime() - leaseMs) } },
        ],
      },
      { $set: { dispatchingSince: now }, $inc: { attempts: 1 } },
      { new: true, projection: ROW_FIELDS },
    ).lean();
  }

  /**
   * Keeps that one mail of the row went out, so a retry leaves it out.
   *
   * @param {string} id
   * @param {{mailType: string, to: string, deliveredAt: Date}} delivery
   */
  static async markDelivered(id, { mailType, to, deliveredAt }) {
    await SupervisionNotificationModel.updateOne(
      { id },
      { $push: { deliveries: { mailType, to, deliveredAt } } },
    );
  }

  /** Every mail of the row went out: `sent`, the lease given back. */
  static async markSent(id, sentAt) {
    return SupervisionNotificationModel.findOneAndUpdate(
      { id },
      {
        $set: {
          status: NOTIFICATION_STATUS.SENT,
          sentAt,
          lastError: null,
          dispatchingSince: null,
        },
      },
      { new: true, projection: ROW_FIELDS },
    ).lean();
  }

  /**
   * The dispatch failed: `failed` with the reason, the lease given back.
   *
   * @param {string} id
   * @param {string} lastError The message, free of credentials
   */
  static async markFailed(id, lastError) {
    return SupervisionNotificationModel.findOneAndUpdate(
      { id },
      {
        $set: {
          status: NOTIFICATION_STATUS.FAILED,
          lastError,
          dispatchingSince: null,
        },
      },
      { new: true, projection: ROW_FIELDS },
    ).lean();
  }

  /**
   * The rows of the outbox, newest first, paginated.
   *
   * @param {Object} [options]
   * @param {string} [options.status] One of `NOTIFICATION_STATUS`
   * @param {number} [options.page] Default 1
   * @param {number} [options.pageSize] Default 50, at most 200
   * @returns {Promise<{items: Object[], total: number, page: number, pageSize: number}>}
   */
  static async list({ status, page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE),
    );
    const filter = status ? { status } : {};

    const [items, total] = await Promise.all([
      SupervisionNotificationModel.find(filter, ROW_FIELDS)
        .sort({ createdAt: -1, id: 1 })
        .skip((safePage - 1) * safePageSize)
        .limit(safePageSize)
        .lean(),
      SupervisionNotificationModel.countDocuments(filter),
    ]);

    return { items, total, page: safePage, pageSize: safePageSize };
  }
}

module.exports = SupervisionNotificationManager;
