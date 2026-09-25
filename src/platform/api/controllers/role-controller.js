const { RoleManager } = require("../../../commons/data-managers/role-manager");
const MembershipManager = require("../../../commons/data-managers/membership-manager");
const { Role } = require("../../../commons/entities/role/role");
const { v4: uuidv4 } = require("uuid");
const { ForbiddenError } = require("../../../errors/BaseError");
const createComponentLogger = require("../../../middleware/logger");

const logger = createComponentLogger("role-controller.js");

/**
 * Web Controller for Roles.
 */
class RoleController {
  /**
   * The reach first, then the projection (glossary "Reichweite"): under
   * `any` the roles; under `own` - the member's reach, the marker vouched
   * for the membership (`role.list`, `own: "tenantMember"`) - the public
   * projection `{ id, name, tenantId }` where asked for, an empty list
   * otherwise. Without the tenant in the path nobody is a member, so the
   * instance owner alone gets here, with every role of every tenant.
   */
  static async getRoles(request, response) {
    try {
      const user = request.user;
      const tenantId = request.params.tenant;
      const isPublicView =
        request.query.public?.trim()?.toLowerCase() === "true";

      const roles = tenantId
        ? await RoleManager.getTenantRoles(tenantId)
        : await RoleManager.getRoles();

      let allowedRoles;
      if (request.reach === "any") {
        allowedRoles = roles;
      } else if (isPublicView) {
        allowedRoles = roles.map((role) => role.toPublic());
      } else {
        allowedRoles = [];
      }

      logger.info(`Sending ${allowedRoles.length} roles to user ${user?.id}`);
      response.status(200).send(allowedRoles);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get roles");
    }
  }

  /**
   * The roles of the signed-in user in the tenant: the
   * public projection where asked for. The membership is the principal's:
   * a resting membership (glossary "Ruhende Mitgliedschaft") or none gives
   * nothing, an empty list; the role ids themselves are read from the
   * membership, which the principal does not carry.
   */
  static async getUserRolesByTenant(req, res) {
    const { userId, isMember } = req.principal;
    const tenantId = req.params.tenant;
    const isPublicView = Boolean(req.query.public);

    try {
      const membership = isMember
        ? await MembershipManager.getMembershipByTenantAndUserID(
            tenantId,
            userId,
          )
        : null;

      const roleIds = membership ? membership.roles : [];

      const roles = await Promise.all(
        roleIds.map((id) => RoleManager.getRole(id, tenantId)),
      );
      const validRoles = roles.filter((r) => r);

      const allowedRoles = isPublicView
        ? validRoles.map((role) => role.toPublic())
        : validRoles;

      logger.info(`Sending ${allowedRoles.length} roles to user ${userId}`);
      return res.status(200).json(allowedRoles);
    } catch (err) {
      logger.error("Error in getUserRolesByTenant:", err);
      return res.status(500).json({ error: "Could not get user roles" });
    }
  }

  static async getRole(request, response) {
    try {
      const roleId = request.params.id;
      const tenantId = request.params.tenant;
      const user = request.user;

      if (roleId) {
        const role = await RoleManager.getRole(roleId, tenantId);
        if (role) {
          logger.info(`Sending role ${role.id} to user ${user?.id}`);
          response.status(200).send(role);
        } else {
          response.sendStatus(404);
        }
      } else {
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get role");
    }
  }

  /**
   * @obsolete Use createRole or updateRole instead.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async storeRole(request, response, next) {
    const roleId = request.body.id;
    const tenantId = request.params.tenant;
    const role = await RoleManager.getRole(roleId, tenantId);

    const isUpdate = !!role;

    if (isUpdate) {
      await RoleController.updateRole(request, response);
    } else {
      await RoleController.createRole(request, response, next);
    }
  }

  /**
   * The obsolete PUT carries the update marker and names the creation as
   * its second decision (`also`, ADR 0001).
   */
  static async createRole(request, response, next) {
    try {
      const user = request.user;
      const tenantId = request.params.tenant;

      if (request.reaches?.create !== "any") {
        logger.warn(`User ${user?.id} not allowed to create role`);
        return next(new ForbiddenError());
      }

      const role = new Role(request.body);
      role.id = uuidv4();
      role.ownerUserId = user.id;
      role.tenantId = tenantId;

      await RoleManager.storeRole(role, tenantId);
      logger.info(`Created role ${role.id} by user ${user?.id}`);
      response.sendStatus(201);
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not create role");
    }
  }

  static async updateRole(request, response) {
    try {
      const user = request.user;
      const tenantId = request.params.tenant;
      const role = new Role(request.body);

      await RoleManager.storeRole(role, tenantId);
      logger.info(`Updated role ${role.id} by user ${user?.id}`);
      response.sendStatus(201);
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not update role");
    }
  }

  static async removeRole(request, response) {
    try {
      const user = request.user;
      const tenantId = request.params.tenant;
      const roleId = request.params.id;

      if (roleId) {
        const role = await RoleManager.getRole(roleId, tenantId);
        if (!role) {
          return response.sendStatus(404);
        }
        await RoleManager.removeRole(roleId, tenantId);
        logger.info(`Removed role ${role.id} by user ${user?.id}`);
        response.sendStatus(200);
      } else {
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not remove role");
    }
  }
}

module.exports = RoleController;
