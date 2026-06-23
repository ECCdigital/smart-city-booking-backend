const InstanceManager = require("../data-managers/instance-manager");
const UserManager = require("../data-managers/user-manager");
const MembershipManager = require("../data-managers/membership-manager");

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
    const membership = await MembershipManager.getMembershipByTenantAndUserID(
      tenantId,
      userId,
    );
    return membership?.owner === true;
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
    return (
      (object.ownerUserId === userId || object.assignedUserId === userId) &&
      object.tenantId === tenantId
    );
  }

  /**
   * Checks if the affected user is the same as the given user.
   *
   * @param {Object} affectedUser - The user object to check.
   * @param {string} userId - The ID of the user to compare against.
   * @returns {boolean} - Returns true if the affected user is the same as the given user, otherwise false.
   */
  static _isSelf(affectedUser, userId) {
    return affectedUser.id === userId;
  }

  static async _allowAction(object, userId, tenantId, resource, actionType) {
    const anyAction =
      actionType === actions.CREATE ? "create" : `${actionType}Any`;
    const ownAction =
      actionType === actions.CREATE ? "create" : `${actionType}Own`;

    if (await PermissionService._isInstanceOwner(userId)) {
      return true;
    }

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
      anyAction,
    );

    if (hasAny) {
      return true;
    }

    if (PermissionService._isOwner(object, userId, tenantId)) {
      return await UserManager.hasPermission(
        userId,
        tenantId,
        resource,
        ownAction,
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
   * Preloads permission data for repeated read checks (e.g. booking lists).
   *
   * @param {string} userId
   * @param {string} tenantId
   * @param {string} resource
   * @returns {Promise<Object>}
   */
  static async createReadContext(userId, tenantId, resource) {
    const [instance, membership, userPermissions] = await Promise.all([
      InstanceManager.getInstance(),
      MembershipManager.getMembershipByTenantAndUserID(tenantId, userId),
      UserManager.getUserPermissions(userId),
    ]);

    const tenantPermissions = userPermissions.tenants.find(
      (permissions) => permissions.tenantId === tenantId,
    );
    const resourcePermissions = tenantPermissions?.[resource] ?? {};

    return {
      userId,
      tenantId,
      isInstanceOwner: instance.ownerUserIds.includes(userId),
      isTenantOwner: membership?.owner === true,
      hasReadAny:
        tenantPermissions?.isOwner === true ||
        resourcePermissions.readAny === true,
      hasReadOwn:
        tenantPermissions?.isOwner === true ||
        resourcePermissions.readOwn === true,
    };
  }

  /**
   * Synchronous read check using a preloaded context from createReadContext.
   *
   * @param {Object} object
   * @param {Object} context
   * @returns {boolean}
   */
  static allowReadWithContext(object, context) {
    if (context.isInstanceOwner || context.isTenantOwner) {
      return true;
    }

    if (object.tenantId !== context.tenantId) {
      return false;
    }

    if (context.hasReadAny) {
      return true;
    }

    return (
      PermissionService._isOwner(object, context.userId, context.tenantId) &&
      context.hasReadOwn
    );
  }

  /**
   * Whether all objects in a tenant can be read without per-object checks.
   *
   * @param {Object} context
   * @returns {boolean}
   */
  static canReadAllWithContext(context) {
    return (
      context.isInstanceOwner ||
      context.isTenantOwner ||
      context.hasReadAny
    );
  }

  /**
   * Checks if the user has read permissions for any object.
   *
   * @param {string} userId - The ID of the user.
   * @param {string} tenantId - The ID of the tenant.
   * @param {string} resource - The resource type.
   * @returns {Promise<boolean>} - A promise that resolves to true if the user has read permissions for any object, otherwise false.
   */
  static async _allowReadAny(userId, tenantId, resource) {
    if (await PermissionService._isInstanceOwner(userId)) {
      return true;
    }

    if (await PermissionService._isTenantOwner(userId, tenantId)) {
      return true;
    }

    return await UserManager.hasPermission(
      userId,
      tenantId,
      resource,
      "readAny",
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

  static async _allowUpdateAny(userId, tenantId, resource) {
    if (await PermissionService._isInstanceOwner(userId)) {
      return true;
    }

    if (await PermissionService._isTenantOwner(userId, tenantId)) {
      return true;
    }

    return await UserManager.hasPermission(
      userId,
      tenantId,
      resource,
      "updateAny",
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
