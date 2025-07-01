const Tenant = require("../entities/tenant/tenant");
const TenantModel = require("./models/tenantModel");

/**
 * Data Manager for Tenant objects.
 */
class TenantManager {
  /**
   * Get all tenants
   * @returns {Promise<Tenant[]>} List of tenants
   */
  static async getTenants() {
    const rawTenants = await TenantModel.find();
    return rawTenants.map((doc) => doc.toEntity());
  }

  /**
   * Get a specific tenant object from the database.
   *
   * @param {string} id Logical identifier of the tenant
   * @returns {Promise<Tenant|null>} A single tenant object or null
   */
  static async getTenant(id) {
    const rawTenant = await TenantModel.findOne({ id: id });
    if (!rawTenant) {
      return null;
    }
    return rawTenant.toEntity();
  }

  /**
   * Insert a tenant object into the database or update it.
   * Validates the tenant data before storing it.
   *
   * @param {Tenant|Object} tenant The tenant object to be stored.
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns {Promise<Tenant>} The stored tenant object
   * @throws {Error} If validation fails
   */
  static async storeTenant(tenant, upsert = true) {
    const tenantEntity = tenant instanceof Tenant ? tenant : new Tenant(tenant);
    tenantEntity.validate();
    await TenantModel.updateOne({ id: tenantEntity.id }, tenantEntity, {
      upsert: upsert,
      setDefaultsOnInsert: true,
    });

    return tenantEntity;
  }

  /**
   * Remove a tenant object from the database.
   *
   * @param {string} id The identifier of the tenant
   * @returns {Promise<void>}
   */
  static async removeTenant(id) {
    await TenantModel.deleteOne({ id: id });
  }

  /**
   * Get all applications for a tenant
   * @param {string} tenantId
   * @returns {Promise<Array>} List of applications
   */
  static async getTenantApps(tenantId) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });
    if (!rawTenant) {
      return [];
    }
    const tenant = rawTenant.toEntity();
    return tenant.applications;
  }

  /**
   * Get a specific application for a tenant
   * @param {string} tenantId
   * @param {string} appId
   * @returns {Promise<Object|null>} Application or null
   */
  static async getTenantApp(tenantId, appId) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });
    if (!rawTenant) {
      return null;
    }
    const tenant = rawTenant.toEntity();
    return tenant.applications.find((app) => app.id === appId) || null;
  }

  /**
   * Get applications by type for a tenant
   * @param {string} tenantId
   * @param {string} appType
   * @returns {Promise<Array>} List of applications
   */
  static async getTenantAppByType(tenantId, appType) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });
    if (!rawTenant) {
      return [];
    }
    const tenant = rawTenant.toEntity();
    return tenant.applications.filter((app) => app.type === appType);
  }

  /**
   * Check if more tenants can be created
   * @returns {Promise<boolean>} True if more tenants can be created
   */
  static async checkTenantCount() {
    const maxTenants = parseInt(process.env.MAX_TENANTS, 10);
    if (!maxTenants) {
      return true;
    }
    const count = await TenantModel.countDocuments({});
    return count < maxTenants;
  }

  /**
   * Add a user to a tenant
   * @param {string} tenantId
   * @param {string} userId
   * @returns {Promise<void>}
   */
  static async addTenantUser(tenantId, userId) {
    await TenantModel.updateOne(
      { id: tenantId },
      { $addToSet: { users: { userId: userId, roles: [] } } },
    );
  }

  /**
   * Get all users for a tenant
   * @param {string} tenantId
   * @returns {Promise<Array|null>} List of users or null
   */
  static async getTenantUsers(tenantId) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });
    if (!rawTenant) {
      return null;
    }
    const tenant = rawTenant.toEntity();
    return tenant.users;
  }

  /**
   * Get users by roles for a tenant
   * @param {string} tenantId
   * @param {string[]} roles
   * @returns {Promise<Array>} List of users
   */
  static async getTenantUsersByRoles(tenantId, roles) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });
    if (!rawTenant) {
      return [];
    }
    const tenant = rawTenant.toEntity();
    return tenant.users.filter((user) =>
      user.roles.some((role) => roles.includes(role)),
    );
  }

  /**
   * Get roles for a specific user in a tenant
   * @param {string} tenantId
   * @param {string} userId
   * @returns {Promise<string[]|null>} List of roles or null
   */
  static async getTenantUserRoles(tenantId, userId) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });
    if (!rawTenant) {
      return null;
    }
    const tenant = rawTenant.toEntity();
    const user = tenant.users.find((user) => user.userId === userId);
    return user ? user.roles : null;
  }

  /**
   * Add a role to a user in a tenant
   * @param {string} tenantId
   * @param {string} userId
   * @param {string} role
   * @returns {Promise<void>}
   */
  static async addUserRole(tenantId, userId, role) {
    await TenantModel.updateOne(
      { id: tenantId, "users.userId": userId },
      { $addToSet: { "users.$.roles": role } },
    );
  }

  /**
   * Remove a role from a user in a tenant
   * @param {string} tenantId
   * @param {string} userId
   * @param {string} role
   * @returns {Promise<void>}
   */
  static async removeUserRole(tenantId, userId, role) {
    await TenantModel.updateOne(
      { id: tenantId, "users.userId": userId },
      { $pull: { "users.$.roles": role } },
    );
  }

  /**
   * Remove a user from a tenant
   * @param {string} tenantId
   * @param {string} userId
   * @returns {Promise<void>}
   */
  static async removeTenantUser(tenantId, userId) {
    await TenantModel.updateOne(
      { id: tenantId },
      { $pull: { users: { userId: userId } } },
    );
  }
}

module.exports = TenantManager;
