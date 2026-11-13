const TenantManager = require("../../data-managers/tenant-manager");
const AccessPointManager = require("../../data-managers/access-point-manager");
const { DOMAIN } = require("../authorization/reach");
const {
  accessAppTypes,
  createAccessApplication,
  secretFieldsOf,
} = require("../../entities/application/accessApplication");
const {
  BadRequestError,
  ConflictError,
  NotFoundError,
} = require("../../../errors/BaseError");

const APP_TYPE = "access";

/** The stored access application of a provider in a tenant, or null. */
function findApp(tenant, providerId) {
  return (
    (tenant?.applications || []).find(
      (app) => app.type === APP_TYPE && app.id === providerId,
    ) || null
  );
}

function isEmpty(value) {
  return value === undefined || value === null || value === "";
}

class AccessAppLifecycleService {
  /**
   * Restores the backend-owned runtime state of access applications on a
   * tenant that is about to be stored - state the admin UI neither writes
   * nor may drop. Today that is the Salto KS IQ activations.
   *
   * @param {Object|null} previousTenant The stored tenant
   * @param {Object} nextTenant The tenant about to be stored, mutated
   * @returns {Object} `nextTenant`
   */
  static preserveBackendState(previousTenant, nextTenant) {
    const SaltoKsIqActivationService = require("./salto-ks-iq-activation-service");
    return SaltoKsIqActivationService.preserveActivations(
      previousTenant,
      nextTenant,
    );
  }

  /**
   * Removes the backend-owned runtime state of access applications from a
   * tenant answer - it never leaves through the API, not even encrypted.
   *
   * @param {Object|null} tenant The tenant about to be sent, mutated
   * @returns {Object|null} `tenant`
   */
  static redactBackendState(tenant) {
    const SaltoKsIqActivationService = require("./salto-ks-iq-activation-service");
    return SaltoKsIqActivationService.redactActivations(tenant);
  }

  /**
   * Saves the access application of one provider (glossary "Anbindung"):
   * creates it, switched on, or changes the stored one, and nothing else of
   * the tenant. What the request leaves out stays as stored; a secret it
   * leaves empty too. Whether the application is switched on is not the
   * save's to change (`setActive`), nor is the backend-owned state
   * (`preserveBackendState`).
   *
   * @param {string} tenantId
   * @param {string} providerId
   * @param {Object} fields The application as the admin form sends it
   * @param {{reach: string, userId?: string|null}} scope The route's reach
   * @returns {Promise<Object>} The saved application as `exportApplication`
   * @throws {NotFoundError} `access_provider_not_found`, `tenant_not_found`
   */
  static async saveApplication(tenantId, providerId, fields, scope) {
    AccessAppLifecycleService._assertProvider(providerId);
    const tenant = await AccessAppLifecycleService._tenantOf(tenantId, scope);
    const stored = findApp(tenant, providerId);

    const app = createAccessApplication({
      ...stored,
      ...fields,
      type: APP_TYPE,
      id: providerId,
      active: stored ? stored.active : true,
    });
    for (const field of secretFieldsOf(providerId)) {
      if (isEmpty(fields?.[field])) {
        app[field] = stored?.[field] ?? null;
      }
    }
    AccessAppLifecycleService.preserveBackendState(
      { applications: stored ? [stored] : [] },
      { applications: [app] },
    );

    await TenantManager.storeAccessApplication(tenantId, app);
    return AccessAppLifecycleService.exportApplication(app);
  }

  /**
   * Switches the provider's access application on or off, and changes
   * nothing else: switched off it keeps its credentials, its access points
   * and their assignment to bookables, as `active: false` always did.
   *
   * @param {string} tenantId
   * @param {string} providerId
   * @param {boolean} active
   * @param {{reach: string, userId?: string|null}} scope The route's reach
   * @returns {Promise<Object>} The application as `exportApplication`
   * @throws {BadRequestError} `access_app_active_invalid`
   * @throws {NotFoundError} `access_app_not_found`, `tenant_not_found`
   */
  static async setActive(tenantId, providerId, active, scope) {
    if (typeof active !== "boolean") {
      throw new BadRequestError("access_app_active_invalid");
    }
    const stored = await AccessAppLifecycleService._storedApp(
      tenantId,
      providerId,
      scope,
    );

    const app = createAccessApplication({ ...stored, active });
    await TenantManager.storeAccessApplication(tenantId, app);
    return AccessAppLifecycleService.exportApplication(app);
  }

  /**
   * Removes the provider's access application with its credentials. Not
   * while the provider still has access points: they would be left without
   * the credentials they open with.
   *
   * @param {string} tenantId
   * @param {string} providerId
   * @param {{reach: string, userId?: string|null}} scope The route's reach
   * @returns {Promise<void>}
   * @throws {ConflictError} `access_app_has_access_points`
   * @throws {NotFoundError} `access_app_not_found`, `tenant_not_found`
   */
  static async removeApplication(tenantId, providerId, scope) {
    await AccessAppLifecycleService._storedApp(tenantId, providerId, scope);

    const accessPoints = (
      await AccessPointManager.getAccessPoints(tenantId)
    ).filter((point) => point.provider === providerId);
    if (accessPoints.length > 0) {
      throw new ConflictError("access_app_has_access_points", {
        provider: providerId,
        accessPoints: accessPoints.length,
      });
    }

    await TenantManager.removeAccessApplication(tenantId, providerId);
  }

  /**
   * An access application as it leaves through the API: without its
   * secrets and without backend-owned state. Per secret field
   * `storedSecrets` says whether one is stored.
   *
   * @param {Object} app
   * @returns {Object}
   */
  static exportApplication(app) {
    const exported = { ...app };
    const storedSecrets = {};
    for (const field of secretFieldsOf(app.id)) {
      storedSecrets[field] = !isEmpty(exported[field]);
      delete exported[field];
    }
    AccessAppLifecycleService.redactBackendState({ applications: [exported] });
    return { ...exported, storedSecrets };
  }

  /** @private */
  static _assertProvider(providerId) {
    if (!Object.prototype.hasOwnProperty.call(accessAppTypes, providerId)) {
      throw new NotFoundError("access_provider_not_found", {
        provider: providerId,
      });
    }
  }

  /**
   * @private
   * The stored access application of the provider; a provider the tenant
   * has not connected is `404 access_app_not_found`.
   */
  static async _storedApp(tenantId, providerId, scope) {
    AccessAppLifecycleService._assertProvider(providerId);
    const tenant = await AccessAppLifecycleService._tenantOf(tenantId, scope);
    const stored = findApp(tenant, providerId);
    if (!stored) {
      throw new NotFoundError("access_app_not_found", {
        provider: providerId,
      });
    }
    return stored;
  }

  /** @private */
  static async _tenantOf(tenantId, scope) {
    const tenant = await TenantManager.getTenant(tenantId, scope);
    if (!tenant) {
      throw new NotFoundError("tenant_not_found", { tenantId });
    }
    return tenant;
  }

  /**
   * The secret a provider signs its webhooks with, from the tenant's active
   * access application. The webhook route is token-authorized and has no
   * reach, so the domain reads the tenant (ADR 0002).
   *
   * @param {string} tenantId
   * @param {string} providerId
   * @returns {Promise<string|null>} The secret, null without one
   */
  static async webhookSecretOf(tenantId, providerId) {
    const tenant = await TenantManager.getTenant(tenantId, DOMAIN);
    const app = (tenant?.applications || []).find(
      (a) => a.type === APP_TYPE && a.id === providerId && a.active,
    );

    return app?.webhookSecret || app?.notificationSecret || null;
  }
}

module.exports = AccessAppLifecycleService;
