const { v4: uuidv4 } = require("uuid");
const SupervisionHistoryModel = require("./models/supervisionHistoryModel");
const { pageWindow } = require("../services/supervision/page-window");

/**
 * Data manager of the supervision history (glossary "Aufsichtshistorie").
 * Insert-only on purpose: a row is never updated or deleted, so there is no
 * method for it.
 */
class SupervisionHistoryManager {
  /**
   * Writes one history row. The id is drawn here when the caller brings
   * none; a `dedupeKey` the caller sets makes a replay of the same row fail
   * at the unique index instead of writing it twice.
   *
   * @param {Object} row
   * @param {string} row.tenantId
   * @param {string} row.eventType One of `HISTORY_EVENT_TYPES`
   * @param {Date} row.occurredAt
   * @param {{type: string, userId: string|null}} row.actor
   * @param {string|null} [row.offerType]
   * @param {string|null} [row.offerId]
   * @param {string|null} [row.from]
   * @param {string|null} [row.to]
   * @param {string|null} [row.reason]
   * @param {string} [row.origin] One of `HISTORY_ORIGINS`, default `api`
   * @param {string} [row.dedupeKey]
   * @returns {Promise<Object>} The stored row as a plain object
   */
  static async insert(row) {
    const doc = new SupervisionHistoryModel({ id: uuidv4(), ...row });
    await doc.save();
    return doc.toObject();
  }

  /**
   * The history, newest first, one page at a time. Every filter is
   * optional; without `tenantId` the list is instance-wide.
   *
   * @param {Object} [params]
   * @param {string} [params.tenantId]
   * @param {string} [params.offerType]
   * @param {string} [params.offerId]
   * @param {number} [params.page] 1-based
   * @param {number} [params.pageSize] Capped at 200
   * @returns {Promise<{items: Object[], total: number, page: number, pageSize: number}>}
   */
  static async list({ tenantId, offerType, offerId, page, pageSize } = {}) {
    const window = pageWindow({ page, pageSize });

    const filter = {};
    if (tenantId) filter.tenantId = tenantId;
    if (offerType) filter.offerType = offerType;
    if (offerId) filter.offerId = offerId;

    const [items, total] = await Promise.all([
      SupervisionHistoryModel.find(filter)
        .sort({ occurredAt: -1, id: 1 })
        .skip(window.skip)
        .limit(window.pageSize)
        .lean(),
      SupervisionHistoryModel.countDocuments(filter),
    ]);

    return { items, total, page: window.page, pageSize: window.pageSize };
  }
}

module.exports = SupervisionHistoryManager;
