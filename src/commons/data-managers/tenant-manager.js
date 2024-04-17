const validate = require("jsonschema").validate;

const Tenant = require("../entities/tenant");
const dbm = require("../utilities/database-manager");
const SecurityUtils = require("../utilities/security-utils");

const TENANT_ENCRYPT_KEYS = [
  "paymentMerchantId",
  "paymentProjectId",
  "paymentSecret",
  "noreplyPassword",
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
  static storeTenant(tenant, upsert = true) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("tenants")
        .replaceOne(
          { id: tenant.id },
          SecurityUtils.encryptObject(tenant, TENANT_ENCRYPT_KEYS),
          {
            upsert: upsert,
          },
        )
        .then(() => resolve())
        .catch((err) => reject(err));
    });
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

  static getTenantApps(tenantId) {
    try {
      const tenant = dbm.get().collection("tenants").findOne({
        id: tenantId,
      });
      return tenant.applications;
    } catch (err) {
      throw new Error(`No tenant found with ID: ${tenantId}`);
    }
  }

  static getTenantApp(tenantId, appId) {
    try {
      const tenant = dbm.get().collection("tenants").findOne({
        id: tenantId,
      });
      return tenant.applications.find((app) => app.id === appId);
    } catch (err) {
      throw new Error(`No tenant found with ID: ${tenantId}`);
    }
  }

  static getTenantAppByType(tenantId, appType) {
    try {
      const tenant = dbm.get().collection("tenants").findOne({
        id: tenantId,
      });
      return tenant.applications.filter((app) => app.type === appType);
    } catch (err) {
      throw new Error(`No tenant found with ID: ${tenantId}`);
    }
  }
}

module.exports = TenantManager;
