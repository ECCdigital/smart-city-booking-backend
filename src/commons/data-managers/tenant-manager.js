const Tenant = require("../entities/tenant");
const TenantModel = require("./models/tenantModel");

/**
 * Data Manager for Tenant objects.
 */
class TenantManager {
  /**
   * Get all tenants
   * @returns List of tenants
   */
  static async getTenants() {
    const rawTenants = await TenantModel.find();
    return rawTenants.map((rt) => {
      return new Tenant(rt);
    });
  }

  /**
   * Get a specific tenant object from the database.
   *
   * @param {string} id Logical identifier of the bookable object
   * @returns A single bookable object
   */
  static async getTenant(id) {
    const rawTenant = await TenantModel.findOne({ id: id });
    if (!rawTenant) {
      return null;
    }
    return new Tenant(rawTenant);
  }

  /**
   * Insert a tenant object into the database or update it.
   *
   * @param {Tenant} tenant The tenant object to be stored.
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns Promise<>
   */
  static async storeTenant(tenant, upsert = true) {
    const newTenant = new Tenant(tenant);

    await TenantModel.updateOne({ id: tenant.id }, newTenant, {
      upsert: upsert,
      setDefaultsOnInsert: true,
    });

    return newTenant;
  }

  /**
   * Remove a tenant object from the database.
   *
   * @param {string} id The identifier of the tenant
   * @returns Promise<>
   */
  static async removeTenant(id) {
    await TenantModel.deleteOne({ id: id });
  }

  static async getTenantApps(tenantId) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });
    const tenant = new Tenant(rawTenant);
    return tenant.applications;
  }

  static async getTenantApp(tenantId, appId) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });

    const tenant = new Tenant(rawTenant);
    return tenant.applications.find((app) => app.id === appId);
  }

  static async getTenantAppByType(tenantId, appType) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });

    const tenant = new Tenant(rawTenant);
    return tenant.applications.filter((app) => app.type === appType);
  }

  static async checkTenantCount() {
    const maxTenants = parseInt(process.env.MAX_TENANTS, 10);
    const count = await TenantModel.countDocuments({});
    return !(maxTenants && count >= maxTenants);
  }

  static addTenantUser(tenantId, userId) {
    return TenantModel.updateOne(
      { id: tenantId },
      { $addToSet: { users: { userId: userId, roles: [] } } },
    );
  }

  static async getTenantUsers(tenantId) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });
    if (!rawTenant) {
      return null;
    }
    const tenant = new Tenant(rawTenant);
    return tenant.users;
  }

  static async getTenantUsersByRoles(tenantId, roles) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });
    if (!rawTenant) {
      return [];
    }
    const tenant = new Tenant(rawTenant);
    return tenant.users.filter((user) =>
      user.roles.some((role) => roles.includes(role)),
    );
  }

  static async getTenantUserRoles(tenantId, userId) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });
    if (!rawTenant) {
      return [];
    }
    const tenant = new Tenant(rawTenant);
    const user = tenant.users.find((user) => user.userId === userId);
    return user ? user.roles : null;
  }

  static async addUserRole(tenantId, userId, role) {
    await TenantModel.updateOne(
      { id: tenantId, "users.userId": userId },
      { $addToSet: { "users.$.roles": role } },
    );
  }

  static async removeUserRole(tenantId, userId, role) {
    await TenantModel.updateOne(
      { id: tenantId, "users.userId": userId },
      { $pull: { "users.$.roles": role } },
    );
  }
}

module.exports = TenantManager;
