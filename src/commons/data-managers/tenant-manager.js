const Tenant = require("../entities/tenant/tenant");
const TenantModel = require("./models/tenantModel");
const {
  CustomFieldCache,
} = require("../services/custom-field/custom-field-cache");
const {
  CustomFieldService,
} = require("../services/custom-field/custom-field-service");
const { BookableManager } = require("./bookable-manager");
const MembershipManager = require("./membership-manager");
const { ownCondition } = require("../services/authorization/reach");
const {
  normalizeCancellationRefundTiers,
} = require("../utilities/cancellation-refund-tiers");

/**
 * The per-year document counters at the tenant. They belong to the number
 * draw (`incrementDocumentCounter`) alone: a whole-tenant write never
 * carries them, so a stale copy of the tenant cannot roll a counter back.
 */
const DOCUMENT_COUNTERS = ["receiptCount", "invoiceCount", "cancellationCount"];

/**
 * Data Manager for Tenant objects.
 */
class TenantManager {
  /**
   * The tenants within a reach (authorize spec §4.1): all of them under
   * `any` or for a caller without a reach, under `own` those of the user's
   * active memberships - `owned` narrows them to the ones the user owns.
   *
   * @param {{reach?: string, userId?: string|null}} [scope]
   * @param {Object} [options]
   * @param {boolean} [options.owned=false] Only the tenants the user owns.
   * @returns {Promise<Tenant[]>} List of tenants
   */
  static async getTenants(scope = {}, { owned = false } = {}) {
    const rawTenants = await TenantModel.find(
      await TenantManager._reachCondition(scope, owned),
    );
    return rawTenants.map((doc) => doc.toEntity());
  }

  /**
   * The query condition of a reach: a tenant has no owner key of its own,
   * "own" is the user's membership in it.
   *
   * @param {{reach?: string, userId?: string|null}} scope
   * @param {boolean} owned
   * @returns {Promise<Object>}
   */
  static async _reachCondition(scope, owned) {
    const { userId } = ownCondition("userId", scope);
    if (!userId) {
      return {};
    }
    const memberships = await MembershipManager.getMembershipsByUserID(userId);
    const ids = memberships
      .filter((m) => m.status === "active" && (!owned || m.owner === true))
      .map((m) => m.tenantId);
    return { id: { $in: ids } };
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

    const existingTenant = await TenantModel.findOne(
      { id: tenantEntity.id },
      { bookableCustomFields: 1 },
    ).lean();

    CustomFieldService.normalizeDefinitions(
      tenantEntity.bookableCustomFields || [],
    );
    tenantEntity.cancellationRefundTiers = normalizeCancellationRefundTiers(
      tenantEntity.cancellationRefundTiers || [],
    );
    tenantEntity.validate();
    const update = { ...tenantEntity };
    if (existingTenant) {
      for (const counter of DOCUMENT_COUNTERS) {
        delete update[counter];
      }
    }
    await TenantModel.updateOne({ id: tenantEntity.id }, update, {
      upsert: upsert,
      setDefaultsOnInsert: true,
    });

    const removedFieldIds = CustomFieldService.getRemovedFieldIds(
      existingTenant?.bookableCustomFields || [],
      tenantEntity.bookableCustomFields || [],
    );
    if (removedFieldIds.length > 0) {
      await BookableManager.removeCustomFieldValues(removedFieldIds, {
        tenantId: tenantEntity.id,
      });
    }

    CustomFieldCache.invalidateTenant(tenantEntity.id);

    return tenantEntity;
  }

  /**
   * Draws the next value of a document counter for a year in one atomic
   * increment at the tenant row, so two draws at the same moment can never
   * answer the same value.
   *
   * @param {string} tenantId The tenant
   * @param {"receiptCount"|"invoiceCount"|"cancellationCount"} counter
   * @param {number} year The year the counter is kept for
   * @returns {Promise<number|null>} The new value, or null without the tenant
   */
  static async incrementDocumentCounter(tenantId, counter, year) {
    if (!DOCUMENT_COUNTERS.includes(counter)) {
      throw new Error(`Unknown document counter: ${counter}`);
    }

    const tenant = await TenantModel.findOneAndUpdate(
      { id: tenantId },
      { $inc: { [`${counter}.${year}`]: 1 } },
      { new: true },
    )
      .select(counter)
      .lean();

    return tenant ? tenant[counter][year] : null;
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
   * Find the tenant that references a medium in one of its legal documents.
   * The usage proof is searched on demand (§4.7 of the media spec); a medium
   * never carries a back reference.
   *
   * Instance media run through the same proof with `tenantId: null`. A tenant
   * document never references one, and searching across all tenants would be
   * the wrong answer rather than a wider one — so that case answers empty.
   *
   * @param {string|null} tenantId Tenant of the medium
   * @param {string} mediaId ID of the medium
   * @returns {Promise<Array<{id: string, title: string}>>} Usage sites
   */
  static async getMediaUsage(tenantId, mediaId) {
    if (!tenantId || !mediaId) {
      return [];
    }

    const doc = await TenantModel.findOne(
      {
        id: tenantId,
        "legalDocuments.reference.mediaId": mediaId,
      },
      { id: 1, name: 1 },
    ).lean();

    return doc ? [{ id: doc.id, title: doc.name || "" }] : [];
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
