const Invitation = require("../entities/tenant/invitation");
const MembershipManager = require("../data-managers/membership-manager");
const MailController = require("../mail-service/mail-controller");
const crypto = require("crypto");
const InvitationManager = require("../data-managers/invitation-manager");

class InvitationService {
  static async createInvitation(
    params = {
      tenantId: null,
      type: "",
      roles: [],
      intendedUserId: null,
      maxUses: null,
      expiresAt: null,
    },
  ) {
    const token = crypto.randomBytes(16).toString("hex");

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

  static async verifyInvitation(tenantID, token, userID = null) {
    const invitation = await InvitationManager.getInvitationByToken(token);

    validateInvitation(invitation, tenantID, userID);

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

    await InvitationManager.incrementUsedCount(token);

    return await InvitationManager.getInvitationByToken(token);
  }

  static async deleteUserInvitation(tenantID, userID) {
    const invitations = await InvitationManager.getInvitationsByTenantIDAndUserID(tenantID, userID);
    if (!invitations) {
      return true;
    }
    for (const invitation of invitations) {
      await InvitationManager.deleteInvitation(tenantID, invitation.token);
    }
    return true;
  }
}

module.exports = InvitationService;

function validateInvitation(invitation, tenantID, userID = null) {
  if (!invitation) {
    throw new Error("Invalid invitation token");
  }

  if (invitation.tenantId !== tenantID) {
    throw new Error("Invitation does not belong to this tenant");
  }

  if (invitation.revoked) {
    throw new Error("Invitation has been revoked");
  }

  if (invitation.expiresAt && Date.now() > invitation.expiresAt) {
    throw new Error("Invitation has expired");
  }

  if (invitation.type === "single" && invitation.usedCount >= 1) {
    throw new Error("Invitation has already been used");
  }

  if (
    invitation.type === "multi" &&
    invitation.usedCount >= invitation.maxUses
  ) {
    throw new Error("Invitation has reached its maximum uses");
  }

  if (
    userID &&
    invitation.intendedUserId &&
    invitation.intendedUserId !== userID
  ) {
    throw new Error("This invitation is not intended for you");
  }

  return true;
}
