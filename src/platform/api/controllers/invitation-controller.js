const InvitationService = require("../../../commons/services/invitation-service");
const PermissionService = require("../../../commons/services/permission-service");
const { RolePermission } = require("../../../commons/entities/role/role");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "invitation-controller.js",
  level: process.env.LOG_LEVEL,
});

class InvitationController {
  static async getInvitationsByTenantID(request, response) {
    try {
      const tenantID = request.params.tenant;
      const user = request.user;

      if (
        !(await PermissionService._allowUpdateAny(
          user.id,
          tenantID,
          RolePermission.MANAGE_USERS,
        ))
      ) {
        return response
          .status(403)
          .send("Forbidden: You don't have permission to access invitations.");
      }

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
      const user = request.user;
      const { type, roles, intendedUserId: intendedUserId, maxUses, expiresAt } = request.body;

      const sanitizedUserId = intendedUserId?.toLowerCase()?.trim();

      if (
        !(await PermissionService._allowUpdateAny(
          user.id,
          tenantID,
          RolePermission.MANAGE_USERS,
        ))
      ) {
        return response
          .status(403)
          .send("Forbidden: You don't have permission to create invitations.");
      }

      if (!type || !["single", "multi"].includes(type)) {
        return response.status(400).send("Invalid or missing invitation type.");
      }

      const invitation = await InvitationService.createInvitation({
        tenantId: tenantID,
        type,
        roles,
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
      const user = request.user;

      if (
        !(await PermissionService._allowUpdateAny(
          user.id,
          tenantID,
          RolePermission.MANAGE_USERS,
        ))
      ) {
        return response
          .status(403)
          .send("Forbidden: You don't have permission to delete invitations.");
      }

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

      await InvitationService.acceptInvitation(tenantId, token, user.id);

      return response.status(200).send({ ok: true });
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
      const user = request.user;
      const { userId: userID } = request.body;

      if (
        !(await PermissionService._allowUpdateAny(
          user.id,
          tenantID,
          RolePermission.MANAGE_USERS,
        ))
      ) {
        return response
          .status(403)
          .send("Forbidden: You don't have permission to resend invitations.");
      }

      await InvitationService.resendInvitationMail(tenantID, userID);

      response
        .status(200)
        .send({ message: "Invitation email resent successfully." });
    } catch (error) {
      logger.error(error);
      response.status(500).send(error.message);
    }
  }
}

module.exports = InvitationController;
