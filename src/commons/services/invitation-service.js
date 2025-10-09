const Invitation = require("../entities/tenant/invitation");
const MembershipManager = require("../data-managers/membership-manager");
const MailController = require("../mail-service/mail-controller");
const crypto = require("crypto");
const InvitationManager = require("../data-managers/invitation-manager");
const ChallengeManager = require("../data-managers/challenge-manager");
const ChallengeService = require("./challenge/challenge-service");

class InvitationService {
  static async createInvitation(
    params = {
      tenantId: null,
      type: "",
      roles: [],
      challenges: [],
      intendedUserId: null,
      maxUses: null,
      expiresAt: null,
    },
  ) {
    if (!params.tenantId) {
      throw new Error("Tenant ID is required to create an invitation");
    }

    const token = crypto.randomBytes(32).toString("hex");

    const challenges = await ChallengeManager.getChallengesByTenantID(
      params.tenantId,
    );

    const activeChallenges = challenges.filter((c) => c.enabled);

    const challengeRefs = params.challenges.filter((challengeId) =>
      activeChallenges.some((c) => c.id === challengeId),
    );

    const invitation = new Invitation({
      ...params,
      token,
      challenges: challengeRefs,
    });

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
    if (membership && membership.status === "suspended") {
      throw { message: "Membership suspended", code: 423 };
    }

    return invitation;
  }

  static async acceptInvitation(tenantID, token, userID) {
    const invitationEntity =
      await InvitationManager.getInvitationByToken(token);

    validateInvitation(invitationEntity, tenantID, userID);

    let { membership } = await this._ensureMembershipInvite(
      tenantID,
      userID,
      token,
    );

    membership = await this._syncChallengeStatesWithInvitation(
      tenantID,
      token,
      membership,
    );

    let membershipInvite = membership.invitations.find(
      (i) => i.token === token,
    );

    // Early exit if already completed
    if (membershipInvite && membershipInvite.status === "completed") {
      const roles = await InvitationService.getInvitationRoles(tenantID, token);
      return {
        success: true,
        message: "Invitation already completed",
        roles,
      };
    }

    if (membership && membership.status === "suspended") {
      throw { message: "Membership suspended", code: 423 };
    }

    membershipInvite = membership.invitations.find((i) => i.token === token);

    let challengeResults = [];
    let pendingManualApproval = false;

    if (invitationEntity.challenges && invitationEntity.challenges.length > 0) {
      for (const challengeID of invitationEntity.challenges) {
        try {
          const result = await ChallengeService.performChallenge(
            challengeID,
            userID,
            tenantID,
          );


          challengeResults.push({
            challengeID,
            success: result.success,
            message: result.message,
            pendingApproval: result.pendingApproval || false,
          });

          const mem = await MembershipManager.getMembershipByTenantAndUserID(
            tenantID,
            userID,
          );
          const inv = mem.invitations.find((i) => i.token === token);
          if (inv) {
            this._upsertChallengeStateInMemory(inv, challengeID, {
              status: result.pendingApproval
                ? "pending_approval"
                : result.success
                  ? "passed"
                  : "failed",
              message: result.message,
            });
            await MembershipManager.updateMembership(tenantID, userID, {
              invitations: mem.invitations,
            });
          }

          // Check if this is a manual approval challenge that's pending
          if (result.pendingApproval) {
            pendingManualApproval = true;
          }
        } catch (error) {
          challengeResults.push({
            challengeID,
            success: false,
            message: error.message || "Unknown error occurred",
          });

          const mem = await MembershipManager.getMembershipByTenantAndUserID(
            tenantID,
            userID,
          );
          const inv = mem.invitations.find((i) => i.token === token);
          if (inv) {
            this._upsertChallengeStateInMemory(inv, challengeID, {
              status: "failed",
              message: error.message || "Unknown error occurred",
            });
            await MembershipManager.updateMembership(tenantID, userID, {
              invitations: mem.invitations,
            });
          }
        }
      }
    }

    const allChallengesPassed = challengeResults.every((cr) => cr.success);

    if (pendingManualApproval) {
      const mem = await MembershipManager.getMembershipByTenantAndUserID(
        tenantID,
        userID,
      );
      const inv = mem.invitations.find((i) => i.token === token);

      if (inv) {
        inv.status = "pending_approval";
      }

      await MembershipManager.updateMembership(tenantID, userID, {
        invitations: mem.invitations,
      });

      const consumed = await InvitationManager.consumeUse(tenantID, token);
      if (consumed && consumed.type === "single") {
        const exhausted =
          consumed.type === "single" ||
          (consumed.maxUses != null && consumed.usedCount >= consumed.maxUses);
        if (exhausted) {
          await InvitationManager.updateInvitation(tenantID, token, {
            status: "exhausted",
          });
        }
      }

      return {
        success: false,
        message: "Your membership is pending manual approval",
        pendingApproval: true,
        challengeResults,
      };
    } else if (allChallengesPassed) {
      const roles = await InvitationService.getInvitationRoles(tenantID, token);

      const mem = await MembershipManager.getMembershipByTenantAndUserID(
        tenantID,
        userID,
      );

      const inv = mem.invitations.find((i) => i.token === token);
      if (inv) {
        inv.status = "completed";
      }

      await MembershipManager.updateMembership(tenantID, userID, {
        status: "active",
        roles: Array.from(new Set([...(mem.roles || []), ...roles])),
        invitations: mem.invitations,
      });

      const consumed = await InvitationManager.consumeUse(tenantID, token);
      if (consumed) {
        const exhausted =
          consumed.type === "single" ||
          (consumed.maxUses != null && consumed.usedCount >= consumed.maxUses);
        if (exhausted) {
          await InvitationManager.updateInvitation(tenantID, token, {
            status: "exhausted",
          });
        }
      }

      return {
        success: true,
        message: "Invitation accepted successfully",
        roles,
      };
    } else {
      const mem = await MembershipManager.getMembershipByTenantAndUserID(
        tenantID,
        userID,
      );
      const inv = mem.invitations.find((i) => i.token === token);

      if (inv) {
        inv.status = "failed";
        inv.reason = challengeResults
          .filter((cr) => !cr.success)
          .map((fc) => fc.message)
          .join("; ");
      }

      const failedChallenges = challengeResults.filter((cr) => !cr.success);

      if (membershipInvite) {
        membershipInvite.reason = failedChallenges
          .map((fc) => fc.message)
          .join("; ");
      }

      await MembershipManager.updateMembership(tenantID, userID, {
        invitations: mem.invitations,
      });

      return {
        success: false,
        message: "Some challenges failed",
        challengeResults,
      };
    }
  }

  static async tryFinalizePendingInvitationsForUser(tenantID, userID) {
    let membership = await MembershipManager.getMembershipByTenantAndUserID(
      tenantID,
      userID,
    );
    if (!membership) return [];

    const results = [];

    for (const inv of membership.invitations || []) {
      membership = await this._syncChallengeStatesWithInvitation(
        tenantID,
        inv.token,
        membership,
      );
      const refreshed = membership.invitations.find(
        (i) => i.token === inv.token,
      );
      if (!refreshed) continue;

      const prev = refreshed.status;
      const next = InvitationService.computeInvitationStatus(refreshed);
      if (prev !== next) {
        refreshed.status = next;
      }
      if (next === "failed") {
        refreshed.reason = (refreshed.challengeStates || [])
          .filter((c) => c.status === "failed")
          .map((c) => c.message)
          .join("; ");
      }
      if (next === "completed" && prev !== "completed") {
        const roles = await InvitationService.getInvitationRoles(
          tenantID,
          refreshed.token,
        );
        membership.roles = Array.from(
          new Set([...(membership.roles || []), ...roles]),
        );
        membership.status = "active";
      }
    }

    await MembershipManager.updateMembership(tenantID, userID, {
      invitations: membership.invitations,
      status: membership.status,
      roles: membership.roles,
    });

    for (const inv of membership.invitations || []) {
      results.push({
        token: inv.token,
        status: inv.status,
      });
    }

    return results;
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

  static async getInvitationRoles(tenantID, token) {
    const invitation = await InvitationManager.getInvitationByToken(token);

    if (!invitation) {
      throw { message: "Invalid invitation token", code: 404 };
    }
    if (invitation.tenantId !== tenantID) {
      throw { message: "Invitation does not belong to this tenant", code: 400 };
    }

    const roles = [...invitation.roles];

    for (const challenge of invitation.challenges) {
      const challengeEntity = await ChallengeManager.getChallengeByID(
        tenantID,
        challenge,
      );
      if (challengeEntity && challengeEntity.enabled) {
        for (const role of challengeEntity.rolesToAssign) {
          if (!roles.includes(role)) {
            roles.push(role);
          }
        }
      }
    }
    return roles;
  }

  static async _ensureMembershipInvite(tenantID, userID, token) {
    let membership = await MembershipManager.getMembershipByTenantAndUserID(
      tenantID,
      userID,
    );

    if (!membership) {
      await MembershipManager.addMembership(tenantID, {
        userId: userID,
        status: "pending",
        source: "invite",
        invitations: [{ token, status: "pending", challengeStates: [] }],
      });
      membership = await MembershipManager.getMembershipByTenantAndUserID(
        tenantID,
        userID,
      );
    }
    let invite = (membership.invitations || []).find((i) => i.token === token);
    if (!invite) {
      membership.invitations.push({
        token,
        status: "pending",
        challengeStates: [],
      });
      await MembershipManager.updateMembership(tenantID, userID, {
        invitations: membership.invitations,
      });
      membership = await MembershipManager.getMembershipByTenantAndUserID(
        tenantID,
        userID,
      );
      invite = membership.invitations.find((i) => i.token === token);
    }
    return { membership, invite };
  }

  static async _syncChallengeStatesWithInvitation(tenantID, token, membership) {
    const invitationEntity =
      await InvitationManager.getInvitationByToken(token);
    if (!invitationEntity) return membership;

    const invite = membership.invitations.find((i) => i.token === token);
    if (!invite) return membership;

    const currentIds = new Set(invitationEntity.challenges || []);
    const states = invite.challengeStates || [];

    const filtered = states.filter((cs) => currentIds.has(cs.challengeId));

    for (const cid of currentIds) {
      if (!filtered.find((cs) => cs.challengeId === cid)) {
        filtered.push({
          challengeId: cid,
          status: "pending",
          message: "",
          updatedAt: new Date(),
          approvedBy: null,
        });
      }
    }

    invite.challengeStates = filtered;
    await MembershipManager.updateMembership(tenantID, membership.userId, {
      invitations: membership.invitations,
    });
    return await MembershipManager.getMembershipByTenantAndUserID(
      tenantID,
      membership.userId,
    );
  }

  static _upsertChallengeStateInMemory(invite, challengeID, next) {
    const idx = (invite.challengeStates || []).findIndex(
      (cs) => cs.challengeId === challengeID,
    );
    const entry = {
      challengeId: challengeID,
      status: next.status,
      message: next.message || "",
      updatedAt: new Date(),
      approvedBy: next.approvedBy || null,
    };
    if (idx >= 0) invite.challengeStates[idx] = entry;
    else {
      invite.challengeStates = invite.challengeStates || [];
      invite.challengeStates.push(entry);
    }
  }

  static computeInvitationStatus(invite, { lockCompleted = true } = {}) {
    if (lockCompleted && invite.status === "completed") return "completed";
    const states = invite.challengeStates || [];
    if (states.some((s) => s.status === "failed")) return "failed";
    if (states.some((s) => s.status === "pending_approval"))
      return "pending_approval";
    if (states.length === 0 || states.every((s) => s.status === "passed"))
      return "completed";
    return "pending";
  }

  /**
   * Approval auf Membership-Ebene setzen (nicht in der Challenge-Config).
   * Optional kann token übergeben werden, sonst werden alle passenden Invites des Users aktualisiert.
   */
  static async approveManualChallenge(
    tenantID,
    { userId, challengeId, adminId, token = null },
  ) {
    const membership = await MembershipManager.getMembershipByTenantAndUserID(
      tenantID,
      userId,
    );
    if (!membership) {
      throw { message: "Membership not found", code: 404 };
    }
    const targets = (membership.invitations || []).filter((inv) => {
      if (token && inv.token !== token) return false;
      return (inv.challengeStates || []).some(
        (cs) =>
          cs.challengeId === challengeId &&
          (cs.status === "pending_approval" || cs.status === "pending"),
      );
    });
    const now = new Date();
    for (const inv of targets) {
      const cs = inv.challengeStates.find((c) => c.challengeId === challengeId);
      cs.status = "passed";
      cs.approvedBy = adminId || null;
      cs.message = "Approved by admin";
      cs.updatedAt = now;
    }
    await MembershipManager.updateMembership(tenantID, userId, {
      invitations: membership.invitations,
    });
    return { updatedInvitations: targets.map((t) => t.token) };
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
