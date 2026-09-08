const InvitationService = require("../../../commons/services/invitation-service");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const { normalizeUserId } = require("../../../commons/utilities/user-id-utils");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "invitation-controller.js",
  level: process.env.LOG_LEVEL,
});

class InvitationController {
  static async getInvitationsByTenantID(request, response) {
    try {
      const tenantID = request.params.tenant;

      const invitations =
        await InvitationService.getMultiUseInvitations(tenantID);

      response.status(200).send(invitations);
    } catch (error) {
      logger.error(error);
      response
        .status(error.code || 500)
        .send(error.message || "Could not fetch invitations");
    }
  }

  static async getMyInvitations(request, response) {
    try {
      const user = request.user;

      const invitations = await InvitationService.getPendingInvitationsForUser(
        user.id,
      );

      const tenant = await TenantManager.getTenants();

      const invitationsWithTenantNames = invitations.map((invitation) => {
        return {
          token: invitation.token,
          tenantId: invitation.tenantId,
          tenantName:
            tenant.find((t) => t.id === invitation.tenantId)?.name || "",
        };
      });

      response.status(200).send(invitationsWithTenantNames);
    } catch (error) {
      logger.error(error);
      response
        .status(error.code || 500)
        .send(error.message || "Could not fetch invitations");
    }
  }

  static async createInvitation(request, response) {
    try {
      const tenantID = request.params.tenant;
      const {
        type,
        roles,
        intendedUserId: intendedUserId,
        maxUses,
        expiresAt,
        challenges,
      } = request.body;

      const sanitizedUserId = intendedUserId
        ? normalizeUserId(intendedUserId)
        : null;

      if (!type || !["single", "multi"].includes(type)) {
        return response.status(400).send("Invalid or missing invitation type.");
      }

      const invitation = await InvitationService.createInvitation({
        tenantId: tenantID,
        type,
        roles,
        challenges: Array.isArray(challenges) ? challenges : [],
        intendedUserId: sanitizedUserId || null,
        maxUses: maxUses || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });

      response.status(201).send(invitation);
    } catch (error) {
      logger.error(error);
      response
        .status(error.code || 500)
        .send(error.message || "Could not create invitation");
    }
  }
  static async deleteInvitation(request, response) {
    try {
      const tenantID = request.params.tenant;
      const token = request.params.token;

      const success = await InvitationService.deleteInvitation(tenantID, token);
      if (success) {
        response
          .status(200)
          .send({ message: "Invitation deleted successfully." });
      } else {
        response.status(404).send({ error: "Invitation not found." });
      }
    } catch (error) {
      logger.error(error);
      response
        .status(error.code || 500)
        .send(error.message || "Could not delete invitation");
    }
  }
  static async verifyInvitationToken(request, response) {
    try {
      const { token } = request.params;
      const tenantId = request.params.tenant;
      const user = request.user;

      await InvitationService.verifyInvitation(tenantId, token, user?.id);

      const tenant = await TenantManager.getTenant(tenantId);

      return response.status(200).send({ ok: true, tenantName: tenant.name });
    } catch (error) {
      logger.error(error);
      return response
        .status(error.code || 500)
        .send(error.message || "Could not verify invitation token");
    }
  }

  static async acceptInvitationToken(request, response) {
    try {
      const { token } = request.params;
      const tenantId = request.params.tenant;
      const user = request.user;

      const result = await InvitationService.acceptInvitation(
        tenantId,
        token,
        user.id,
      );

      // If the result indicates pending approval, return a specific status
      if (result && result.pendingApproval) {
        return response.status(202).send({
          ok: false,
          pendingApproval: true,
          message: result.message,
          challengeResults: result.challengeResults,
        });
      }

      // If the result indicates failure but not pending approval, return an error
      if (result && !result.success && !result.pendingApproval) {
        return response.status(400).send({
          ok: false,
          message: result.message,
          challengeResults: result.challengeResults,
        });
      }

      // Success case
      return response.status(200).send({
        ok: true,
        message: result.message,
        roles: result.roles,
      });
    } catch (error) {
      logger.error(error);
      return response
        .status(error.code || 500)
        .send(error.message || "Could not accept invitation token");
    }
  }

  static async rejectInvitationToken(request, response) {
    try {
      const { token } = request.params;
      const tenantId = request.params.tenant;
      const user = request.user;

      await InvitationService.rejectInvitation(tenantId, token, user.id);

      return response.status(200).send({ ok: true });
    } catch (error) {
      logger.error(error);

      return response
        .status(error.code || 500)
        .send(error.message || "Could not reject invitation token");
    }
  }

  static async resendInvitation(request, response) {
    try {
      const tenantID = request.params.tenant;
      const { userId: userID } = request.body;
      const normalizedUserId = normalizeUserId(userID);

      if (!normalizedUserId) {
        return response.status(400).send("User ID is required");
      }

      await InvitationService.resendInvitationMail(tenantID, normalizedUserId);

      response
        .status(200)
        .send({ message: "Invitation email resent successfully." });
    } catch (error) {
      logger.error(error);
      response.status(500).send(error.message);
    }
  }

  static async approveManualChallenge(request, response) {
    try {
      const tenantID = request.params.tenant;
      const user = request.user;
      const { challengeId, userId, token } = request.body;

      // Validate required parameters
      if (!challengeId || !userId) {
        return response
          .status(400)
          .send(
            "Missing required parameters: challengeId and userId are required.",
          );
      }

      await InvitationService.approveManualChallenge(tenantID, {
        challengeId,
        userId,
        adminId: user.id,
        token: token || null,
      });

      try {
        const finalizeResults =
          await InvitationService.tryFinalizePendingInvitationsForUser(
            tenantID,
            userId,
          );
        logger.info({ finalizeResults }, "Finalize after manual approval");
      } catch (e) {
        logger.warn({ err: e }, "Finalize after approval failed");
      }

      // Return success response
      response
        .status(200)
        .send({ message: "Challenge approved successfully." });
    } catch (error) {
      logger.error(error);
      response
        .status(error.code || 500)
        .send(error.message || "Could not approve challenge");
    }
  }

  static async rejectManualChallenge(request, response) {
    try {
      const tenantID = request.params.tenant;
      const user = request.user;
      const { challengeId, userId, token } = request.body;

      // Validate required parameters
      if (!challengeId || !userId) {
        return response
          .status(400)
          .send(
            "Missing required parameters: challengeId and userId are required.",
          );
      }

      await InvitationService.rejectManualChallenge(tenantID, {
        challengeId,
        userId,
        adminId: user.id,
        token: token || null,
      });

      try {
        const finalizeResults =
          await InvitationService.tryFinalizePendingInvitationsForUser(
            tenantID,
            userId,
          );
        logger.info({ finalizeResults }, "Finalize after manual approval");
      } catch (e) {
        logger.warn({ err: e }, "Finalize after approval failed");
      }

      // Return success response
      response
        .status(200)
        .send({ message: "Challenge rejected successfully." });
    } catch (error) {
      logger.error(error);
      response
        .status(error.code || 500)
        .send(error.message || "Could not reject challenge");
    }
  }

  static async deleteUserInvitation(request, response) {
    try {
      const tenantID = request.params.tenant;
      const userID = request.params.userId;
      const { token } = request.body;

      await InvitationService.deleteUserInvitation(tenantID, userID, token);

      response
        .status(200)
        .send({ message: "User invitation deleted successfully." });
    } catch (error) {
      logger.error(error);
      response
        .status(error.code || 500)
        .send(error.message || "Could not delete user invitation");
    }
  }
}

module.exports = InvitationController;
