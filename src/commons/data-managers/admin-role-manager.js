const AdminRoleModel = require("./models/adminRoleModel");
const AdminRole = require("../entities/admin/adminRole");

class AdminRoleManager {
  static async getRoles(tenantId) {
    const raw = await AdminRoleModel.find({ tenantId }).sort({
      builtin: -1,
      created: 1,
    });
    return raw.map((doc) => doc.toEntity());
  }

  static async getRole(tenantId, id) {
    const raw = await AdminRoleModel.findOne({ tenantId, id });
    return raw ? raw.toEntity() : null;
  }

  static async storeRole(role, upsert = true) {
    const entity = role instanceof AdminRole ? role : new AdminRole(role);
    entity.validate();
    await AdminRoleModel.updateOne(
      { tenantId: entity.tenantId, id: entity.id },
      { ...entity },
      { upsert, runValidators: true },
    );
    return entity;
  }

  static async removeRole(tenantId, id) {
    const res = await AdminRoleModel.deleteOne({ tenantId, id });
    return res.deletedCount > 0;
  }
}

module.exports = AdminRoleManager;
