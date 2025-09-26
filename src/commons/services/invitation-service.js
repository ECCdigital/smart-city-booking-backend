const Invitation = require("../entities/tenant/invitation");
const MembershipManager = require("../data-managers/membership-manager");
const MailController = require("../mail-service/mail-controller");
const crypto = require("crypto");
const InvitationManager = require("../data-managers/invitation-manager");
const ChallengeManager = require("../data-managers/challenge-manager");

class InvitationService {
  static async createInvitation(
    params = {
      tenantId: null,
      type: "",
      roleAssignments: [],
      intendedUserId: null,
      maxUses: null,
      expiresAt: null,
    },
  ) {
    const token = crypto.randomBytes(16).toString("hex");

    const challenges = await ChallengeManager.getChallengesByTenantID(
      params.tenantId,
    );

    const activeChallenges = challenges.filter((c) => c.status === "active");

    console.log("Active challenges:", activeChallenges);

    const invitation = new Invitation({ ...params, token });

    return await InvitationManager.createInvitation(
      params.tenantId,
      invitation,
    );
  }

  static async sendInvitationMail(tenantID, token, recipientEmail = null) {
    const invitation = await InvitationManager.getInvitationByToken(token);

    validateInvitation(invitation, tenantID, recipientEmail);

    if (!recipientEmail && !invitation.intendedUserId) {
      throw new Error("No recipient email or intended user ID provided");
    }

    await MailController.sendInvitationEmail({
      sendTo: recipientEmail ? recipientEmail : invitation.intendedUserId,
      token,
      tenantId: tenantID,
    });

    return true;
  }

  static async resendInvitationMail(tenantID, userID) {
    const invitation =
      await InvitationManager.getInvitationsByTenantIDAndUserID(
        tenantID,
        userID,
      );

    if (!invitation) {
      throw new Error("Invitation not found");
    }

    await InvitationManager.updateInvitation(tenantID, invitation[0].token, {
      status: "active",
    });

    await MailController.sendInvitationEmail({
      sendTo: invitation[0].intendedUserId,
      token: invitation[0].token,
      tenantId: tenantID,
    });

    await MembershipManager.updateMembership(tenantID, userID, {
      status: "pending",
    });

    return true;
  }

  static async verifyInvitation(tenantID, token, userID = null) {
    const invitation = await InvitationManager.getInvitationByToken(token);

    validateInvitation(invitation, tenantID, userID);

    const membership = await MembershipManager.getMembershipByTenantAndUserID(
      tenantID,
      userID,
    );
    if (membership && membership.status === "active") {
      throw new Error("User is already a member of this tenant");
    }

    return invitation;
  }

  static async acceptInvitation(tenantID, token, userID) {
    const invitation = await InvitationManager.getInvitationByToken(token);

    validateInvitation(invitation, tenantID, userID);

    const membership = await MembershipManager.getMembershipByTenantAndUserID(
      tenantID,
      userID,
    );

    if (membership) {
      const updates = {
        roles: Array.from(new Set([...membership.roles, ...invitation.roles])),
        status: "active",
      };

      await MembershipManager.updateMembership(tenantID, userID, updates);
    } else {
      await MembershipManager.addMembership(tenantID, {
        userId: userID,
        roles: invitation.roles,
        status: "active",
        source: "invite",
      });
    }

    if (
      invitation.type === "single" ||
      (invitation.maxUses && invitation.usedCount + 1 >= invitation.maxUses)
    ) {
      await InvitationManager.deleteInvitation(tenantID, token);
    } else {
      await InvitationManager.incrementUsedCount(token);
    }

    return true;
  }

  static async deleteUserInvitation(tenantID, userID) {
    const invitations =
      await InvitationManager.getInvitationsByTenantIDAndUserID(
        tenantID,
        userID,
      );
    if (!invitations) {
      return true;
    }
    for (const invitation of invitations) {
      await InvitationManager.deleteInvitation(tenantID, invitation.token);
    }
    return true;
  }

  static async deleteInvitation(tenantID, token) {
    const invitation = await InvitationManager.getInvitationByToken(token);
    if (!invitation) {
      throw new Error("Invitation not found");
    }
    if (invitation.tenantId !== tenantID) {
      throw new Error("Invitation does not belong to this tenant");
    }
    await InvitationManager.deleteInvitation(tenantID, token);
    return true;
  }

  static async getMultiUseInvitations(tenantID) {
    const invitations =
      await InvitationManager.getInvitationsByTenantID(tenantID);
    return invitations.filter((invitation) => invitation.type === "multi");
  }

  static async getPendingInvitationsForUser(userID) {
    const invitations = await InvitationManager.getInvitationByUserID(userID);
    return invitations.filter(
      (invitation) =>
        invitation.status === "active" &&
        (!invitation.expiresAt || Date.now() <= invitation.expiresAt) &&
        (invitation.type === "multi"
          ? invitation.usedCount < invitation.maxUses
          : invitation.usedCount < 1),
    );
  }

  static async rejectInvitation(tenantID, token, userID) {
    const invitation = await InvitationManager.getInvitationByToken(token);

    validateInvitation(invitation, tenantID, userID);

    if (invitation.intendedUserId !== userID) {
      throw new Error("This invitation is not intended for you");
    }

    await MembershipManager.updateMembership(tenantID, userID, {
      status: "rejected",
    });

    await InvitationManager.updateInvitation(tenantID, token, {
      status: "rejected",
    });

    return true;
  }
}

module.exports = InvitationService;

function validateInvitation(invitation, tenantID, userID = null) {
  if (!invitation) {
    throw { message: "Invalid invitation token", code: 404 };
  }

  if (invitation.tenantId !== tenantID) {
    throw { message: "Invitation does not belong to this tenant", code: 400 };
  }

  if (invitation.status === "revoked") {
    throw { message: "Invitation has been revoked", code: 410 };
  }

  if (invitation.expiresAt && Date.now() > invitation.expiresAt) {
    throw { message: "Invitation has expired", code: 410 };
  }

  if (invitation.type === "single" && invitation.usedCount >= 1) {
    throw { message: "Invitation has already been used", code: 410 };
  }

  if (
    invitation.maxUses &&
    invitation.usedCount &&
    invitation.usedCount >= invitation.maxUses
  ) {
    throw { message: "Invitation has reached its maximum uses", code: 410 };
  }

  if (
    userID &&
    invitation.intendedUserId &&
    invitation.intendedUserId !== userID
  ) {
    throw { message: "This invitation is not intended for you", code: 403 };
  }

  return true;
}
