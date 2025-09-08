const InvitationModel = require("./models/invitationModel");

class InvitationManager {
  static async getInvitationsByTenantID(tenantID) {
    const rawInvitations = await InvitationModel.find({ tenantId: tenantID });
    return rawInvitations.map((raw) => raw.toEntity());
  }

  static async getInvitationByToken(token) {
    const rawInvitation = await InvitationModel.findOne({ token: token });
    if (!rawInvitation) {
      return null;
    }
    return rawInvitation.toEntity();
  }

  static async getInvitationsByTenantIDAndUserID(tenantID, userID) {
    const rawInvitation = await InvitationModel.find({
      tenantId: tenantID,
      intendedUserId: userID,
    });
    return rawInvitation.map((raw) => raw.toEntity());
  }

  static async createInvitation(tenantID, invitation) {
    const newInvitation = new InvitationModel({
      tenantId: tenantID,
      ...invitation,
    });
    const savedInvitation = await InvitationModel.create(newInvitation);

    return savedInvitation.toEntity();
  }

  static async incrementUsedCount(token) {
    await InvitationModel.updateOne(
      { token: token },
      { $inc: { usedCount: 1 } },
    );
  }

  static async revokeInvitation(token) {
    await InvitationModel.updateOne(
      { token: token },
      { $set: { revoked: true } },
    );
  }

  static async deleteInvitation(tenantID, token) {
    await InvitationModel.deleteOne({
      tenantId: tenantID,
      token: token,
    });
  }
}

module.exports = InvitationManager;
