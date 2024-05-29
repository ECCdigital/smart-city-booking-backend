const validate = require("jsonschema").validate;

const Tenant = require("../entities/tenant");
const dbm = require("../utilities/database-manager");
const SecurityUtils = require("../utilities/security-utils");

const TENANT_ENCRYPT_KEYS = [
  "paymentMerchantId",
  "paymentProjectId",
  "paymentSecret",
  "noreplyPassword",
  "password",
];

/**
 * Data Manager for Tenant objects.
 */
class TenantManager {
  /**
   * Check if an object is a valid Tenant.
   *
   * @param {object} tenant A tenant object
   * @returns true, if the object is a valid tenant object
   */
  static validateTenant(tenant) {
    const schema = require("../schemas/tenant.schema.json");
    return validate(tenant, schema).errors.length === 0;
  }

  /**
   * Get all tenants
   * @returns List of tenants
   */
  static getTenants() {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("tenants")
        .find({})
        .toArray()
        .then((rawTenants) => {
          const tenants = rawTenants.map((rt) => {
            const tenant = Object.assign(new Tenant(), rt);
            tenant.applications = tenant.applications.map((app) => {
              return SecurityUtils.decryptObject(app, TENANT_ENCRYPT_KEYS);
            });
            return SecurityUtils.decryptObject(tenant, TENANT_ENCRYPT_KEYS);
          });

          resolve(tenants);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Get a specific tenant object from the database.
   *
   * @param {string} id Logical identifier of the bookable object
   * @returns A single bookable object
   */
  static getTenant(id) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("tenants")
        .findOne({ id: id })
        .then((rawTenant) => {
          if (!rawTenant) {
            return reject(new Error(`No tenant found with ID: ${id}`));
          }
          const tenant = Object.assign(new Tenant(), rawTenant);
          tenant.applications = tenant.applications.map((app) => {
            return SecurityUtils.decryptObject(app, TENANT_ENCRYPT_KEYS);
          });
          resolve(SecurityUtils.decryptObject(tenant, TENANT_ENCRYPT_KEYS));
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Insert a tenant object into the database or update it.
   *
   * @param {Tenant} tenant The tenant object to be stored.
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns Promise<>
   */
  static async storeTenant(tenant, upsert = true) {
    try {
      const tenantsCollection = dbm.get().collection("tenants");
      tenant.applications = tenant.applications.map((app) => {
        return SecurityUtils.encryptObject(app, TENANT_ENCRYPT_KEYS);
      });

      await tenantsCollection.replaceOne(
        { id: tenant.id },
        SecurityUtils.encryptObject(tenant, TENANT_ENCRYPT_KEYS),
        { upsert: upsert },
      );
    } catch (err) {
      throw new Error(`Error storing tenant: ${err.message}`);
    }
  }

  /**
   * Remove a tenant object from the database.
   *
   * @param {string} id The identifier of the tenant
   * @returns Promise<>
   */
  static removeTenant(id) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("tenants")
        .deleteOne({ id: id })
        .then(() => resolve())
        .catch((err) => reject(err));
    });
  }

  static async getTenantApps(tenantId) {
    try {
      const tenant = await dbm.get().collection("tenants").findOne({
        id: tenantId,
      });
      return tenant.applications;
    } catch (err) {
      throw new Error(`No tenant found with ID: ${tenantId}`);
    }
  }

  static async getTenantApp(tenantId, appId) {
    try {
      const tenant = await dbm.get().collection("tenants").findOne({
        id: tenantId,
      });
      return tenant.applications.find((app) => app.id === appId);
    } catch (err) {
      throw new Error(`No tenant found with ID: ${tenantId}`);
    }
  }

  static async getTenantAppByType(tenantId, appType) {
    try {
      const tenant = await dbm.get().collection("tenants").findOne({
        id: tenantId,
      });
      return tenant.applications.filter((app) => app.type === appType);
    } catch (err) {
      throw new Error(`No tenant found with ID: ${tenantId}`);
    }
  }
  static async checkTenantCount() {
    const maxTenants = parseInt(process.env.MAX_TENANTS, 10);
    const count = await dbm.get().collection("tenants").countDocuments({});
    return !(maxTenants && count >= maxTenants);
  }
}

module.exports = TenantManager;
