const InvitationModel = require("./models/invitationModel");
const { normalizeUserId } = require("../utilities/user-id-utils");

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
      intendedUserId: normalizeUserId(userID),
    });
    return rawInvitation.map((raw) => raw.toEntity());
  }

  static async getInvitationByUserID(userID) {
    const rawInvitation = await InvitationModel.find({
      intendedUserId: normalizeUserId(userID),
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

  static async updateInvitation(tenantID, token, update) {
    const rawInvitation = await InvitationModel.findOneAndUpdate(
      { tenantId: tenantID, token: token },
      update,
      { new: true },
    );

    if (!rawInvitation) {
      return null;
    }

    return rawInvitation.toEntity();
  }

  static async deleteInvitation(tenantID, token) {
    await InvitationModel.deleteOne({
      tenantId: tenantID,
      token: token,
    });
  }

  /**
   * Atomically consume one use of an invitation.
   * Returns the updated invitation entity or null if it could not be consumed
   * (e.g. already exhausted, revoked, or not found).
   */
  static async consumeUse(tenantID, token) {
    const inv = await InvitationModel.findOne({ tenantId: tenantID, token });
    if (!inv) return null;
    if (inv.status !== "active") return null;

    let filter;
    if (inv.type === "single") {
      filter = {
        tenantId: tenantID,
        token,
        status: "active",
        usedCount: { $lt: 1 },
      };
    } else {
      if (inv.maxUses == null) {
        filter = { tenantId: tenantID, token, status: "active" };
      } else {
        filter = {
          tenantId: tenantID,
          token,
          status: "active",
          usedCount: { $lt: inv.maxUses },
        };
      }
    }

    const update = { $inc: { usedCount: 1 } };
    const updated = await InvitationModel.findOneAndUpdate(filter, update, {
      new: true,
    });
    return updated ? updated.toEntity() : null;
  }
}

module.exports = InvitationManager;
