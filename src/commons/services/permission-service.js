const InstanceManager = require("../data-managers/instance-manager");
const TenantManager = require("../data-managers/tenant-manager");
const UserManager = require("../data-managers/user-manager");

const actions = {
  CREATE: "create",
  READ: "read",
  UPDATE: "update",
  DELETE: "delete",
};

/**
 * A service class for handling permission checks.
 */
class PermissionService {

  /**
   * Checks if the user is the owner of the instance.
   *
   * @param {string} userId - The ID of the user.
   * @returns {Promise<boolean>} - A promise that resolves to true if the user is the owner of the instance, otherwise false.
   */
  static async _isInstanceOwner(userId) {
    const instance = await InstanceManager.getInstance();
    return instance.ownerUserIds.includes(userId);
  }

  /**
   * Checks if the user is the owner of the given tenant.
   *
   * @param {string} userId - The ID of the user.
   * @param {string} tenantId - The ID of the tenant.
   * @returns {Promise<boolean>} - A promise that resolves to true if the user is the owner of the tenant, otherwise false.
   */
  static async _isTenantOwner(userId, tenantId) {
    const tenant = await TenantManager.getTenant(tenantId);
    return tenant.ownerUserIds.includes(userId);
  }

  /**
   * Checks if the user is the owner of the given object.
   *
   * @param {Object} object - The object to check ownership for.
   * @param {string} userId - The ID of the user.
   * @param {string} tenantId - The ID of the tenant.
   * @returns {boolean} - Returns true if the user is the owner of the object, otherwise false.
   */
  static _isOwner(object, userId, tenantId) {
    return object.assignedUserId === userId && object.tenantId === tenantId;
  }

  /**
   * A service class for handling permission checks.
   */
  static _isSelf(affectedUser, userId) {
    return affectedUser.id === userId;
  }

  static async _allowAction(object, userId, tenantId, resource, actionType) {
    if (await PermissionService._isTenantOwner(userId, tenantId)) {
      return true;
    }
    if (object.tenantId !== tenantId) {
      return false;
    }
    const hasAny = await UserManager.hasPermission(
      userId,
      tenantId,
      resource,
      `${actionType}Any`,
    );
    if (hasAny) {
      return true;
    }
    if (PermissionService._isOwner(object, userId, tenantId)) {
      return await UserManager.hasPermission(
        userId,
        tenantId,
        resource,
        `${actionType}Own`,
      );
    }
    return false;
  }

  /**
   * Checks if the user has read permissions for the given object.
   *
   * @param {Object} object - The object to check permissions for.
   * @param {string} userId - The ID of the user.
   * @param {string} tenantId - The ID of the tenant.
   * @param {string} resource - The resource type.
   * @returns {Promise<boolean>} - A promise that resolves to true if the user has read permissions, otherwise false.
   */
  static async _allowRead(object, userId, tenantId, resource) {
    return await PermissionService._allowAction(
      object,
      userId,
      tenantId,
      resource,
      actions.READ,
    );
  }

  /**
   * Checks if the user has create permissions for the given object.
   *
   * @param {Object} object - The object to check permissions for.
   * @param {string} userId - The ID of the user.
   * @param {string} tenantId - The ID of the tenant.
   * @param {string} resource - The resource type.
   * @returns {Promise<boolean>} - A promise that resolves to true if the user has create permissions, otherwise false.
   */
  static async _allowCreate(object, userId, tenantId, resource) {
    return await PermissionService._allowAction(
      object,
      userId,
      tenantId,
      resource,
      actions.CREATE,
    );
  }

  /**
   * Checks if the user has update permissions for the given object.
   *
   * @param {Object} object - The object to check permissions for.
   * @param {string} userId - The ID of the user.
   * @param {string} tenantId - The ID of the tenant.
   * @param {string} resource - The resource type.
   * @returns {Promise<boolean>} - A promise that resolves to true if the user has update permissions, otherwise false.
   */
  static async _allowUpdate(object, userId, tenantId, resource) {
    return await PermissionService._allowAction(
      object,
      userId,
      tenantId,
      resource,
      actions.UPDATE,
    );
  }

  /**
   * Checks if the user has delete permissions for the given object.
   *
   * @param {Object} object - The object to check permissions for.
   * @param {string} userId - The ID of the user.
   * @param {string} tenantId - The ID of the tenant.
   * @param {string} resource - The resource type.
   * @returns {Promise<boolean>} - A promise that resolves to true if the user has delete permissions, otherwise false.
   */
  static async _allowDelete(object, userId, tenantId, resource) {
    return await PermissionService._allowAction(
      object,
      userId,
      tenantId,
      resource,
      actions.DELETE,
    );
  }
}

module.exports = PermissionService;
