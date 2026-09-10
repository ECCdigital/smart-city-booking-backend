const AdminInvitationModel = require("./models/adminInvitationModel");
const AdminInvitation = require("../entities/admin/adminInvitation");

class AdminInvitationManager {
  static async getByToken(token) {
    const raw = await AdminInvitationModel.findOne({ token });
    return raw ? raw.toEntity() : null;
  }

  static async getPendingByEmail(tenantId, email) {
    const raw = await AdminInvitationModel.findOne({
      tenantId,
      email,
      status: "pending",
    });
    return raw ? raw.toEntity() : null;
  }

  static async getPending(tenantId) {
    const raw = await AdminInvitationModel.find({
      tenantId,
      status: "pending",
    }).sort({ created: 1 });
    return raw.map((doc) => doc.toEntity());
  }

  static async countPendingByRole(tenantId, roleId) {
    return AdminInvitationModel.countDocuments({
      tenantId,
      roleId,
      status: "pending",
    });
  }

  static async store(invitation, upsert = true) {
    const entity =
      invitation instanceof AdminInvitation
        ? invitation
        : new AdminInvitation(invitation);
    entity.validate();
    await AdminInvitationModel.updateOne(
      { id: entity.id, tenantId: entity.tenantId },
      { ...entity },
      { upsert, runValidators: true },
    );
    return entity;
  }

  static async remove(tenantId, id) {
    await AdminInvitationModel.deleteOne({ tenantId, id });
  }
}

module.exports = AdminInvitationManager;
