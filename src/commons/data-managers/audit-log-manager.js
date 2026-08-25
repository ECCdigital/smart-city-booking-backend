const AuditLogModel = require("./models/auditLogModel");
const { escapeRegex } = require("../utilities/regex-utils");

class AuditLogManager {
  static async append(entry) {
    // best-effort: skip if the connection is not ready (don't buffer the write)
    if (AuditLogModel.db.readyState !== 1) {
      return;
    }
    await AuditLogModel.create(entry);
  }

  static async list(tenantId, { q, action, limit = 100, offset = 0 } = {}) {
    const filter = { tenantId };
    if (action) {
      filter.action = action;
    }
    if (q) {
      filter.message = { $regex: escapeRegex(String(q)), $options: "i" };
    }
    const total = await AuditLogModel.countDocuments(filter);
    const rows = await AuditLogModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit);
    return {
      items: rows.map((doc) => ({
        id: String(doc._id),
        action: doc.action,
        message: doc.message,
        actorId: doc.actorId || "",
        actorName: doc.actorName || "",
        createdAt: doc.createdAt,
      })),
      total,
    };
  }
}

module.exports = AuditLogManager;
