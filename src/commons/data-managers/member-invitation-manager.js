const MemberInvitation = require("../entities/company/memberInvitation");
const MemberInvitationModel = require("./models/memberInvitationModel");

class MemberInvitationManager {
  static async getPendingByCompany(tenantId, companyId) {
    const raw = await MemberInvitationModel.find({
      tenantId,
      companyId,
      status: "pending",
    }).sort({ created: 1 });
    return raw.map((doc) => doc.toEntity());
  }

  static async getByToken(token) {
    const raw = await MemberInvitationModel.findOne({ token });
    if (!raw) {
      return null;
    }
    return raw.toEntity();
  }

  static async getPendingByEmail(tenantId, companyId, email) {
    const raw = await MemberInvitationModel.findOne({
      tenantId,
      companyId,
      email,
      status: "pending",
    });
    if (!raw) {
      return null;
    }
    return raw.toEntity();
  }

  static async getPendingByEmailInTenant(tenantId, email) {
    const raw = await MemberInvitationModel.findOne({
      tenantId,
      email,
      status: "pending",
    });
    if (!raw) {
      return null;
    }
    return raw.toEntity();
  }

  static async store(invitation, upsert = true) {
    const entity =
      invitation instanceof MemberInvitation
        ? invitation
        : new MemberInvitation(invitation);
    entity.validate();
    await MemberInvitationModel.updateOne(
      { id: entity.id, tenantId: entity.tenantId },
      { ...entity },
      { upsert, runValidators: true },
    );
    return entity;
  }

  static async remove(tenantId, id) {
    await MemberInvitationModel.deleteOne({ tenantId, id });
  }
}

module.exports = MemberInvitationManager;
