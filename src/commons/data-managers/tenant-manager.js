const Tenant = require("../entities/tenant");
const SecurityUtils = require("../utilities/security-utils");

const mongoose = require("mongoose");

const { Schema } = mongoose;
const TenantSchema = new Schema(Tenant.schema());

TenantSchema.pre("save", async function (next) {
  if (this.isModified("paymentMerchantId"))
    this.paymentMerchantId = SecurityUtils.encrypt(this.paymentMerchantId);
  if (this.isModified("paymentProjectId"))
    this.paymentProjectId = SecurityUtils.encrypt(this.paymentProjectId);
  if (this.isModified("paymentSecret"))
    this.paymentSecret = SecurityUtils.encrypt(this.paymentSecret);
  if (this.isModified("noreplyPassword"))
    this.noreplyPassword = SecurityUtils.encrypt(this.noreplyPassword);
  if (this.isModified("password"))
    this.password = SecurityUtils.encrypt(this.password);
  if (this.isModified("noreplyGraphClientSecret"))
    this.noreplyGraphClientSecret = SecurityUtils.encrypt(
      this.noreplyGraphClientSecret,
    );
  next();
});

TenantSchema.post("init", function (doc) {
  if (doc.paymentMerchantId) {
    doc.paymentMerchantId = SecurityUtils.decrypt(doc.paymentMerchantId);
  }
  if (doc.paymentProjectId) {
    doc.paymentProjectId = SecurityUtils.decrypt(doc.paymentProjectId);
  }
  if (doc.paymentSecret) {
    doc.paymentSecret = SecurityUtils.decrypt(doc.paymentSecret);
  }
  if (doc.noreplyPassword) {
    doc.noreplyPassword = SecurityUtils.decrypt(doc.noreplyPassword);
  }
  if (doc.password) {
    doc.password = SecurityUtils.decrypt(doc.password);
  }
  if (doc.noreplyGraphClientSecret) {
    doc.noreplyGraphClientSecret = SecurityUtils.decrypt(
      doc.noreplyGraphClientSecret,
    );
  }
});

const TenantModel =
  mongoose.models.Tenant || mongoose.model("Tenant", TenantSchema);

const TENANT_ENCRYPT_KEYS = [
  "paymentMerchantId",
  "paymentProjectId",
  "paymentSecret",
  "noreplyPassword",
  "password",
  "noreplyGraphClientSecret",
];

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
      console.log(rt.noreplyPassword);
      const tenant = new Tenant(rt);
      tenant.applications = tenant.applications.map((app) => {
        return SecurityUtils.decryptObject(app, TENANT_ENCRYPT_KEYS);
      });
      return tenant;
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
    const tenant = new Tenant(rawTenant);
    tenant.applications = tenant.applications.map((app) => {
      return SecurityUtils.decryptObject(app, TENANT_ENCRYPT_KEYS);
    });
    return SecurityUtils.decryptObject(tenant, TENANT_ENCRYPT_KEYS);
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
    newTenant.applications = newTenant.applications.map((app) => {
      return SecurityUtils.encryptObject(app, TENANT_ENCRYPT_KEYS);
    });

    const rawTenant = await TenantModel.updateOne(
      { id: tenant.id },
      SecurityUtils.encryptObject(newTenant, TENANT_ENCRYPT_KEYS),
      {
        upsert: upsert,
        setDefaultsOnInsert: true,
      },
    );

    return new Tenant(rawTenant);
  }

  //TODO: create Tenant

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
    tenant.applications = tenant.applications.map((app) => {
      return SecurityUtils.decryptObject(app, TENANT_ENCRYPT_KEYS);
    });
    return tenant.applications;
  }

  static async getTenantApp(tenantId, appId) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });

    const tenant = new Tenant(rawTenant);
    const application = tenant.applications.find((app) => app.id === appId);
    return SecurityUtils.decryptObject(application, TENANT_ENCRYPT_KEYS);
  }

  static async getTenantAppByType(tenantId, appType) {
    const rawTenant = await TenantModel.findOne({ id: tenantId });

    const tenant = new Tenant(rawTenant);
    const applications = tenant.applications.filter(
      (app) => app.type === appType,
    );

    return applications.map((app) => {
      return SecurityUtils.decryptObject(app, TENANT_ENCRYPT_KEYS);
    });
  }

  static async checkTenantCount() {
    const maxTenants = parseInt(process.env.MAX_TENANTS, 10);
    const count = await TenantModel.countDocuments({});
    return !(maxTenants && count >= maxTenants);
  }
}

module.exports = TenantManager;
