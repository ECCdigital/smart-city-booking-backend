const Tenant = require("../entities/tenant/tenant");
const TenantModel = require("./models/tenantModel");
const {
  CustomFieldCache,
} = require("../services/custom-field/custom-field-cache");
const {
  CustomFieldService,
} = require("../services/custom-field/custom-field-service");
const { BookableManager } = require("./bookable-manager");
const { ownCondition } = require("../services/authorization/reach");
const { REACH } = require("../services/authorization/policy");
const {
  normalizeCancellationRefundTiers,
} = require("../utilities/cancellation-refund-tiers");
const {
  publicTenantCondition,
} = require("../services/supervision/public-projection");
const {
  SUPERVISION_FIELDS,
  assertSupervisionLevel,
  SUPERVISION_LEVELS,
} = require("../services/supervision/supervision-constants");

/**
 * The per-year document counters at the tenant. They belong to the number
 * draw (`incrementDocumentCounter`) alone: a whole-tenant write never
 * carries them, so a stale copy of the tenant cannot roll a counter back.
 */
const DOCUMENT_COUNTERS = ["receiptCount", "invoiceCount", "cancellationCount"];

/**
 * The supervision fields (glossary "Aufsichtsstufe"). They belong to the
 * level change (`updateSupervisionLevel`) alone once the tenant exists; a
 * whole-tenant write carries them on insert only, so a stale copy of the
 * tenant cannot undo a level change.
 */

/**
 * Data Manager for Tenant objects.
 */
class TenantManager {
  /**
   * The tenants within a reach (ADR 0002): all of them under `any` and for
   * the domain, under `own` the tenant set the scope carries
   * (`tenantIds`: what "own" means for the entry the route decided - the
   * tenants the user owns, or belongs to), under `public` the tenants the
   * public sees (ADR 0003, tenant supervision spec §5.2: those at a
   * public level, a missing level counting as free).
   *
   * @param {{reach: string, userId?: string|null, tenantIds?: string[]}} scope
   * @param {Object} [options]
   * @param {string} [options.supervisionLevel] Only the tenants at this
   *   supervision level (a tenant without a stored level is `free`).
   * @param {Object} [options.sort] A mongoose sort, e.g.
   *   `{ supervisionChangedAt: 1, id: 1 }`; default: the database's order
   * @param {number} [options.skip] Rows to skip - the page's start
   * @param {number} [options.limit] Rows at most - the page's size
   * @returns {Promise<Tenant[]>} List of tenants
   */
  static async getTenants(scope, { supervisionLevel, sort, skip, limit } = {}) {
    const condition = TenantManager._condition(scope, { supervisionLevel });
    let query = TenantModel.find(condition);
    if (sort !== undefined) query = query.sort(sort);
    if (skip !== undefined) query = query.skip(skip);
    if (limit !== undefined) query = query.limit(limit);
    const rawTenants = await query;
    return rawTenants.map((doc) => doc.toEntity());
  }

  /**
   * How many tenants `getTenants` would list under the same scope and
   * options - the `total` of a page of them.
   *
   * @param {{reach: string, userId?: string|null, tenantIds?: string[]}} scope
   * @param {Object} [options]
   * @param {string} [options.supervisionLevel]
   * @returns {Promise<number>}
   */
  static async countTenants(scope, { supervisionLevel } = {}) {
    const condition = TenantManager._condition(scope, { supervisionLevel });
    return TenantModel.countDocuments(condition);
  }

  /** The query condition of `getTenants` and `countTenants`. */
  static _condition(scope, { supervisionLevel }) {
    const condition =
      scope?.reach === REACH.PUBLIC
        ? publicTenantCondition()
        : { ...ownCondition("tenant", scope) };
    if (supervisionLevel) {
      condition.supervisionLevel =
        supervisionLevel === SUPERVISION_LEVELS.FREE
          ? { $in: [supervisionLevel, null] }
          : supervisionLevel;
    }
    return condition;
  }

  /**
   * Sets the supervision level of a tenant, conditionally: the write
   * matches only while the tenant is still at `from`, so two level changes
   * at the same moment cannot both succeed (spec "Concurrency").
   *
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {string} params.from The level the caller read
   * @param {string} params.to The new level
   * @param {Date} params.changedAt
   * @param {string|null} [params.reason] The reason of this change, stored
   *   as the tenant's `supervisionReason` - `null` without one
   * @returns {Promise<Tenant|null>} The tenant after the write, or null
   *   when no tenant at `from` matched
   */
  static async updateSupervisionLevel({
    tenantId,
    from,
    to,
    changedAt,
    reason = null,
  }) {
    assertSupervisionLevel(to);
    // A tenant from before the supervision has no stored level; `from:
    // "free"` has to match it as well.
    const currentLevel =
      from === SUPERVISION_LEVELS.FREE ? { $in: [from, null] } : from;
    const raw = await TenantModel.findOneAndUpdate(
      { id: tenantId, supervisionLevel: currentLevel },
      {
        $set: {
          supervisionLevel: to,
          supervisionChangedAt: changedAt,
          supervisionReason: reason ?? null,
        },
      },
      { new: true },
    );
    return raw ? raw.toEntity() : null;
  }

  /**
   * Get a specific tenant object from the database.
   *
   * @param {string} id Logical identifier of the tenant
   * @param {{reach: string, userId?: string|null}} scope The reach of the
   *   caller (ADR 0002); the domain says `DOMAIN`. Under `public` only a
   *   tenant with a public projection (ADR 0003), under any other the
   *   record.
   * @returns {Promise<Tenant|null>} A single tenant object or null
   * @throws {Error} without a reach
   */
  static async getTenant(id, scope) {
    if (scope?.reach === undefined) {
      throw new Error("authorization: tenant read without a reach");
    }
    // Under `public` the tenant the public sees (ADR 0003): a route that
    // asks as the public gets null for a tenant without a public
    // projection. Every other read - the domain's, a route's about the
    // tenant it names - is the record.
    const condition =
      scope.reach === REACH.PUBLIC ? publicTenantCondition() : {};
    const rawTenant = await TenantModel.findOne({ id: id, ...condition });
    if (!rawTenant) {
      return null;
    }

    return rawTenant.toEntity();
  }

  /**
   * The tenants of some ids, in one query, whatever their supervision
   * level - for the snapshot a customer's booking carries (tenant
   * supervision spec §5.2); the caller knows the bookings, so nothing about
   * a tenant is revealed that the booking does not vouch for.
   *
   * @param {string[]} ids
   * @returns {Promise<Tenant[]>} The tenants that exist, in no order
   */
  static async getTenantsByIds(ids) {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) {
      return [];
    }
    const rawTenants = await TenantModel.find({ id: { $in: unique } });
    return rawTenants.map((doc) => doc.toEntity());
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
      for (const field of [...DOCUMENT_COUNTERS, ...SUPERVISION_FIELDS]) {
        delete update[field];
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

  /**
   * The same cap, asked after a tenant was inserted: whether the tenants,
   * the new one included, still fit `MAX_TENANTS`. Counting after the write
   * lets racing creations see each other, so the cap holds across parallel
   * requests and server processes.
   *
   * @returns {Promise<boolean>} false when the insert overshot the cap
   */
  static async checkTenantCountAfterInsert() {
    const maxTenants = parseInt(process.env.MAX_TENANTS, 10);
    if (!maxTenants) {
      return true;
    }
    const count = await TenantModel.countDocuments({});
    return count <= maxTenants;
  }
}

module.exports = TenantManager;
