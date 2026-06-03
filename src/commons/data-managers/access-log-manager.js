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
}

module.exports = AccessLogManager;
