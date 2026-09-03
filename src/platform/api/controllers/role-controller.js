const { RoleManager } = require("../../../commons/data-managers/role-manager");
const MembershipManager = require("../../../commons/data-managers/membership-manager");
const { Role } = require("../../../commons/entities/role/role");
const { v4: uuidv4 } = require("uuid");
const { ForbiddenError } = require("../../../errors/BaseError");
const { decide } = require("../../../commons/services/authorization");
const createComponentLogger = require("../../../middleware/logger");

const logger = createComponentLogger("role-controller.js");

/**
 * Web Controller for Roles.
 */
class RoleController {
  static async getRoles(request, response) {
    try {
      const user = request.user;
      const tenantId = request.params.tenant;
      const isPublicView =
        request.query.public?.trim()?.toLowerCase() === "true";

      let roles;

      if (tenantId) {
        roles = await RoleManager.getTenantRoles(tenantId);
      } else {
        roles = await RoleManager.getRoles();
      }

      // Under `any` the roles; under `own` the public projection where asked
      // for, else none - a role has no owner (authorize spec §4.1).
      let allowedRoles;
      if (isPublicView) {
        allowedRoles = roles.map((role) => role.toPublic());
      } else if (request.reach === "any") {
        allowedRoles = roles;
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
   * The roles of the signed-in user in the tenant (authorize spec §7.4): the
   * public projection where asked for.
   */
  static async getUserRolesByTenant(req, res) {
    const userId = req.principal.userId;
    const tenantId = req.params.tenant;
    const isPublicView = Boolean(req.query.public);

    try {
      const membership = await MembershipManager.getMembershipByTenantAndUserID(
        tenantId,
        userId,
      );

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
   * The obsolete PUT carries the update marker; the creation is the
   * adapter's second decision (authorize spec §5, §11).
   */
  static async createRole(request, response, next) {
    try {
      const user = request.user;
      const tenantId = request.params.tenant;

      if (decide(request.principal, "role", "create") !== "any") {
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
