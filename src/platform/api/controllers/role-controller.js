const { RoleManager } = require("../../../commons/data-managers/role-manager");
const { Role, RolePermission } = require("../../../commons/entities/role");
const { v4: uuidv4 } = require("uuid");
const UserManager = require("../../../commons/data-managers/user-manager");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "role-controller.js",
  level: process.env.LOG_LEVEL,
});

class RolePermissions {
  static _isOwner(role, userId, tenant) {
    return role.ownerUserId === userId && role.ownerTenant === tenant;
  }

  static async _allowCreate(role, userId, tenant) {
    return await UserManager.hasPermission(
      userId,
      tenant,
      RolePermission.MANAGE_ROLES,
      "create",
    );
  }

  static async _allowRead(role, userId, tenant) {
    if (
      await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_ROLES,
        "readAny",
      )
    )
      return true;

    if (
      RolePermissions._isOwner(role, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_ROLES,
        "readOwn",
      ))
    )
      return true;

    return false;
  }

  static async _allowUpdate(role, userId, tenant) {
    if (
      await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_ROLES,
        "updateAny",
      )
    ) {
      return true;
    }

    if (
      RolePermissions._isOwner(role, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_ROLES,
        "updateOwn",
      ))
    ) {
      return true;
    }

    return false;
  }

  static async _allowDelete(role, userId, tenant) {
    if (
      await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_ROLES,
        "deleteAny",
      )
    )
      return true;

    if (
      RolePermissions._isOwner(role, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_ROLES,
        "deleteOwn",
      ))
    )
      return true;

    return false;
  }
}

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
        if (await RolePermissions._allowRead(role, user.id, tenantId)) {
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
          if (await RolePermissions._allowRead(role, user.id, tenantId)) {
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
    const tenantId = request.params.tenantId;
    const role = await RoleManager.getRole(roleId, tenantId);

    //TODO: Does this still work with Mongoose
    const isUpdate = !!role._id;

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
      role.tenant = tenantId;

      if (await RolePermissions._allowCreate(role, user.id, tenantId)) {
        await RoleManager.storeRole(role);
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

      if (await RolePermissions._allowUpdate(role, user.id, tenantId)) {
        await RoleManager.storeRole(role);
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
        if (await RolePermissions._allowDelete(role, user.id, tenantId)) {
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
