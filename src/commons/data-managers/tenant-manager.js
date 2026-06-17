const Tenant = require("../entities/tenant/tenant");
const TenantModel = require("./models/tenantModel");
const { CustomFieldCache } = require("../services/custom-field/custom-field-cache");
const {
  CustomFieldService,
} = require("../services/custom-field/custom-field-service");
const rawTenant = require("../schemas/tenantSchema");

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
    CustomFieldService.normalizeDefinitions(
      tenantEntity.bookableCustomFields || [],
    );
    tenantEntity.validate();
    await TenantModel.updateOne({ id: tenantEntity.id }, tenantEntity, {
      upsert: upsert,
      setDefaultsOnInsert: true,
    });

    CustomFieldCache.invalidateTenant(tenantEntity.id);

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

  static async getTenantAppById(tenantId, appId) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });
    if (!rawTenant) {
      return null;
    }
    const tenant = rawTenant.toEntity();
    return tenant.applications.find((app) => app.id === appId) || null;
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
}

module.exports = TenantManager;
