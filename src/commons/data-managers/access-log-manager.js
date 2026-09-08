const AccessLogModel = require("./models/accessLogModel");

class AccessLogManager {
  static async insert(logEntry) {
    const doc = new AccessLogModel(logEntry);
    await doc.save();
    return doc.toObject();
  }

  static async getByBooking(tenantId, bookingId) {
    return AccessLogModel.find({ tenantId, bookingId })
      .sort({ timestamp: -1 })
      .lean();
  }

  static async getByAccessPoint(tenantId, accessPointId) {
    return AccessLogModel.find({ tenantId, accessPointId })
      .sort({ timestamp: -1 })
      .lean();
  }

  /**
   * Flexible query for audit exports. All filters except `tenantId` are
   * optional. Results are sorted ascending by timestamp (chronological audit
   * trail) and can be bounded via `limit`.
   *
   * @param {string} tenantId
   * @param {Object} [filters]
   * @param {number} [filters.from] - inclusive lower bound (epoch ms)
   * @param {number} [filters.to] - inclusive upper bound (epoch ms)
   * @param {string} [filters.bookingId]
   * @param {string} [filters.accessPointId]
   * @param {string} [filters.provider]
   * @param {string} [filters.action]
   * @param {string} [filters.result]
   * @param {number} [filters.limit]
   * @returns {Promise<Array>}
   */
  static async query(tenantId, filters = {}) {
    const conditions = { tenantId };

    if (filters.bookingId) conditions.bookingId = filters.bookingId;
    if (filters.accessPointId) conditions.accessPointId = filters.accessPointId;
    if (filters.provider) conditions.provider = filters.provider;
    if (filters.action) conditions.action = filters.action;
    if (filters.result) conditions.result = filters.result;

    if (filters.from != null || filters.to != null) {
      conditions.timestamp = {};
      if (filters.from != null) conditions.timestamp.$gte = filters.from;
      if (filters.to != null) conditions.timestamp.$lte = filters.to;
    }

    let cursor = AccessLogModel.find(conditions).sort({ timestamp: 1 });

    if (Number.isFinite(filters.limit) && filters.limit > 0) {
      cursor = cursor.limit(filters.limit);
    }

    return cursor.lean();
  }
}

module.exports = AccessLogManager;
