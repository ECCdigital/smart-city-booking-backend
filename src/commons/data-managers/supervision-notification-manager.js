const { v4: uuidv4 } = require("uuid");
const SupervisionNotificationModel = require("./models/supervisionNotificationModel");
const {
  NOTIFICATION_STATUS,
} = require("../services/supervision/supervision-constants");

/**
 * Data manager of the supervision notification outbox (glossary
 * "Mitteilungsanlass"). This ticket records occasions only; the sender,
 * the retry and the failure listing come with ticket 11.
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
}

module.exports = SupervisionNotificationManager;
