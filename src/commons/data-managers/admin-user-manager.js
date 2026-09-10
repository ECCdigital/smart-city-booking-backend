const AdminUserModel = require("./models/adminUserModel");
const AdminUser = require("../entities/admin/adminUser");

class AdminUserManager {
  static async getAdmins(tenantId) {
    const raw = await AdminUserModel.find({ tenantId }).sort({ created: 1 });
    return raw.map((doc) => doc.toEntity());
  }

  static async getByUser(tenantId, userId) {
    const raw = await AdminUserModel.findOne({ tenantId, userId });
    return raw ? raw.toEntity() : null;
  }

  static async store(adminUser, upsert = true) {
    const entity =
      adminUser instanceof AdminUser ? adminUser : new AdminUser(adminUser);
    entity.validate();
    await AdminUserModel.updateOne(
      { tenantId: entity.tenantId, userId: entity.userId },
      { ...entity },
      { upsert, runValidators: true },
    );
    return entity;
  }

  static async setRole(tenantId, userId, roleId) {
    await AdminUserModel.updateOne({ tenantId, userId }, { $set: { roleId } });
    return AdminUserManager.getByUser(tenantId, userId);
  }

  static async remove(tenantId, userId) {
    const res = await AdminUserModel.deleteOne({ tenantId, userId });
    return res.deletedCount > 0;
  }

  static async countByRole(tenantId, roleId) {
    return AdminUserModel.countDocuments({ tenantId, roleId });
  }
}

module.exports = AdminUserManager;
