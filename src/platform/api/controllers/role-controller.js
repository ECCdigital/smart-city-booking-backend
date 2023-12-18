const RoleManager = require("../../../commons/data-managers/role-manager");
const { Role, RolePermission } = require("../../../commons/entities/role");
const { v4: uuidv4 } = require("uuid");
const UserManager = require("../../../commons/data-managers/user-manager");

class RolePermissions {
  static _isOwner(role, userId, tenant) {
    return role.ownerUserId === userId && role.ownerTenant === tenant;
  }

  static async _allowCreate(role, userId, tenant) {
    return await UserManager.hasPermission(
      userId,
      tenant,
      RolePermission.MANAGE_ROLES,
      "create"
    );
  }

  static async _allowRead(role, userId, tenant) {
    if (
      await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_ROLES,
        "readAny"
      )
    )
      return true;

    if (
      RolePermissions._isOwner(role, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_ROLES,
        "readOwn"
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
        "updateAny"
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
        "updateOwn"
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
        "deleteAny"
      )
    )
      return true;

    if (
      RolePermissions._isOwner(role, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_ROLES,
        "deleteOwn"
      ))
    )
      return true;

    return false;
  }
}

/**
 * Web Controller for Bookables.
 */
class RoleController {
  static async getRoles(request, response) {
    const user = request.user;
    const roles = await RoleManager.getRoles();

    let allowedRoles = [];
    for (let role of roles) {
      if (await RolePermissions._allowRead(role, user.id, user.tenant)) {
        allowedRoles.push(role);
      }
    }

    response.status(200).send(allowedRoles);
  }

  static async getRole(request, response) {
    const id = request.params.id;
    const user = request.user;

    if (id) {
      const role = await RoleManager.getRole(id);
      if (await RolePermissions._allowRead(role, user.id, user.tenant)) {
        response.status(200).send(role);
      } else {
        response.sendStatus(403);
      }
    } else {
      response.sendStatus(400);
    }
  }

  /**
   * @obsolete Use createRole or updateRole instead.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async storeRole(request, response) {
    const role = await RoleManager.getRole(request.body.id);

    const isUpdate = !!role._id;

    if (isUpdate) {
      await RoleController.updateRole(request, response);
    } else {
      await RoleController.createRole(request, response);
    }
  }

  static async createRole(request, response) {
    const user = request.user;
    const role = Object.assign(new Role(), request.body);

    role.id = uuidv4();
    role.ownerUserId = user.id;
    role.ownerTenant = user.tenant;

    if (await RolePermissions._allowCreate(role, user.id, user.tenant)) {
      await RoleManager.storeRole(role);
      response.sendStatus(201);
    } else {
      response.sendStatus(403);
    }
  }

  static async updateRole(request, response) {
    const user = request.user;
    const role = Object.assign(new Role(), request.body);

    if (await RolePermissions._allowUpdate(role, user.id, user.tenant)) {
      await RoleManager.storeRole(role);
      response.sendStatus(201);
    } else {
      response.sendStatus(403);
    }
  }

  static async removeRole(request, response) {
    const user = request.user;

    const id = request.params.id;
    if (id) {
      const role = await RoleManager.getRole(id);
      if (await RolePermissions._allowDelete(role, user.id, user.tenant)) {
        await RoleManager.removeRole(id);
        response.sendStatus(200);
      } else {
        response.sendStatus(403);
      }
    } else {
      response.sendStatus(400);
    }
  }
}

module.exports = RoleController;
