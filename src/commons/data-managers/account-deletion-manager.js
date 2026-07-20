const AccountDeletionModel = require("./models/accountDeletionModel");

class AccountDeletionManager {
  static async increment(tenantId, role, reasonId, period) {
    const filter = { tenantId, role, reasonId, period };
    try {
      await AccountDeletionModel.updateOne(
        filter,
        { $inc: { count: 1 } },
        { upsert: true },
      );
    } catch (err) {
      // race-safe: after the losing upsert the row exists, so $inc applies
      if (err && err.code === 11000) {
        await AccountDeletionModel.updateOne(filter, { $inc: { count: 1 } });
      } else {
        throw err;
      }
    }
  }

  static async list(tenantId, role) {
    const raw = await AccountDeletionModel.find({ tenantId, role });
    return raw.map((doc) => doc.toEntity());
  }
  static async countByField(tenantId, field, value) {
    return AccountDeletionModel.countDocuments({ tenantId, [field]: value });
  }
}

module.exports = AccountDeletionManager;
