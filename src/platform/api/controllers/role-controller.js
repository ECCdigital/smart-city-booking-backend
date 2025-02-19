const { RoleManager } = require("../../../commons/data-managers/role-manager");
const { Role, RolePermission } = require("../../../commons/entities/role");
const { v4: uuidv4 } = require("uuid");
const PermissionService = require("../../../commons/services/permission-service");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "role-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Web Controller for Roles.
 */
class RoleController {
  static async getRoles(request, response) {
    try {
      const user = request.user;
      const tenantId = request.params.tenant;
      const roles = await RoleManager.getRoles(tenantId);

      let allowedRoles = [];
      for (let role of roles) {
        if (await PermissionService._allowRead(role, user.id, tenantId, RolePermission.MANAGE_ROLES)) {
          allowedRoles.push(role);
        }
      }

      logger.info(`Sending ${allowedRoles.length} roles to user ${user?.id}`);
      response.status(200).send(allowedRoles);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not get roles");
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
          if (await PermissionService._allowRead(role, user.id, tenantId, RolePermission.MANAGE_ROLES)) {
            logger.info(`Sending role ${role.id} to user ${user?.id}`);
            response.status(200).send(role);
          } else {
            logger.warn(
              `User ${user?.id} is not allowed to read role ${role.id}`,
            );
            response.sendStatus(403);
          }
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
  static async storeRole(request, response) {
    const roleId = request.body.id;
    const tenantId = request.params.tenant;
    const role = await RoleManager.getRole(roleId, tenantId);

    const isUpdate = !!role;

    if (isUpdate) {
      await RoleController.updateRole(request, response);
    } else {
      await RoleController.createRole(request, response);
    }
  }

  static async createRole(request, response) {
    try {
      const user = request.user;
      const tenantId = request.params.tenant;
      const role = new Role(request.body);

      role.id = uuidv4();
      role.ownerUserId = user.id;
      role.tenantId = tenantId;

      if (await PermissionService._allowCreate(role, user.id, tenantId, RolePermission.MANAGE_ROLES)) {
        await RoleManager.storeRole(role, tenantId);
        logger.info(`Created role ${role.id} by user ${user?.id}`);
        response.sendStatus(201);
      } else {
        logger.warn(`User ${user?.id} not allowed to create role`);
        response.sendStatus(403);
      }
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

      if (await PermissionService._allowUpdate(role, user.id, tenantId, RolePermission.MANAGE_ROLES)) {
        await RoleManager.storeRole(role, tenantId);
        logger.info(`Updated role ${role.id} by user ${user?.id}`);
        response.sendStatus(201);
      } else {
        logger.warn(`User ${user?.id} not allowed to update role`);
        response.sendStatus(403);
      }
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
        if (await PermissionService._allowDelete(role, user.id, tenantId, RolePermission.MANAGE_ROLES)) {
          await RoleManager.removeRole(roleId, tenantId);
          logger.info(`Removed role ${role.id} by user ${user?.id}`);
          response.sendStatus(200);
        } else {
          logger.warn(`User ${user?.id} not allowed to remove role`);
          response.sendStatus(403);
        }
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
