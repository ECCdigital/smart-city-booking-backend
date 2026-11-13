const TenantManager = require("../../data-managers/tenant-manager");
const AccessPointManager = require("../../data-managers/access-point-manager");
const AccessInfoService = require("./access-info-service");
const { completeSecrets } = require("./connection-test-secrets");
const { DOMAIN } = require("../authorization/reach");
const {
  ACCESS_APP_TYPE,
  accessAppTypes,
  createAccessApplication,
  findAccessApp,
  secretFieldsOf,
} = require("../../entities/application/accessApplication");
const {
  BadRequestError,
  ConflictError,
  NotFoundError,
} = require("../../../errors/BaseError");

/**
 * The connection state of an access application (glossary "Anbindung"),
 * the one the head of its section on the access points page shows.
 */
const CONNECTION_STATES = Object.freeze({
  CONNECTED: "connected",
  FAILING: "failing",
  UNCHECKED: "unchecked",
  DISABLED: "disabled",
});

/** What a test that threw instead of answering records. */
const TEST_THREW = "Could not test access connection";

function isEmpty(value) {
  return value === undefined || value === null || value === "";
}

class AccessAppLifecycleService {
  /**
   * Restores the backend-owned runtime state of access applications on a
   * tenant that is about to be stored - state the admin UI neither writes
   * nor may drop: the Salto KS IQ activations and the last connection test
   * of every access application. The connection state the answers carry is
   * derived, never stored.
   *
   * @param {Object|null} previousTenant The stored tenant
   * @param {Object} nextTenant The tenant about to be stored, mutated
   * @returns {Object} `nextTenant`
   */
  static preserveBackendState(previousTenant, nextTenant) {
    for (const app of nextTenant?.applications || []) {
      if (app.type !== ACCESS_APP_TYPE) continue;
      app.lastTest = findAccessApp(previousTenant, app.id)?.lastTest || null;
      delete app.connectionState;
    }

    const SaltoKsIqActivationService = require("./salto-ks-iq-activation-service");
    return SaltoKsIqActivationService.preserveActivations(
      previousTenant,
      nextTenant,
    );
  }

  /**
   * Keeps the access applications of a tenant that is about to be stored
   * by a whole-tenant write (`PUT api/tenants`) as stored, whatever the
   * write brings: they are written by their own routes alone
   * (`saveApplication`, `setActive`, `removeApplication`), and the admin
   * UI, which never reads their secrets, would drop them. The other
   * applications are the write's.
   *
   * @param {Object|null} previousTenant The stored tenant
   * @param {Object} nextTenant The tenant about to be stored, mutated
   * @returns {Object} `nextTenant`
   */
  static keepStoredApplications(previousTenant, nextTenant) {
    nextTenant.applications = [
      ...(nextTenant.applications || []).filter(
        (app) => app?.type !== ACCESS_APP_TYPE,
      ),
      ...(previousTenant?.applications || []).filter(
        (app) => app?.type === ACCESS_APP_TYPE,
      ),
    ];
    return nextTenant;
  }

  /**
   * Turns the access applications in a tenant answer into what may leave
   * through the API: their secrets never leave - per secret field
   * `storedSecrets` says whether one is stored (`secretFieldsOf`); the
   * Salto KS IQ activations never leave, not even encrypted; the last test
   * leaves without its fingerprint, and beside it the connection state
   * (`connectionStateOf`). Each access application is answered as a copy
   * (`exportApplication`); payment and sign-in applications as they are.
   *
   * @param {Object|null} tenant The tenant about to be sent, mutated
   * @returns {Object|null} `tenant`
   */
  static redactBackendState(tenant) {
    if (Array.isArray(tenant?.applications)) {
      // Copies: the applications may be the ones just read or stored.
      tenant.applications = tenant.applications.map((app) =>
        app?.type === ACCESS_APP_TYPE
          ? AccessAppLifecycleService.exportApplication(app)
          : app,
      );
    }
    return tenant;
  }

  /**
   * The connection state of an access application: `disabled` while it is
   * switched off; else, while its last test checked the stored values (the
   * fingerprints match), `connected` if that test succeeded and `failing`
   * if not; else `unchecked` - never tested, or changed since.
   *
   * @param {Object} app The stored application, secrets in plain text
   * @returns {"connected"|"failing"|"unchecked"|"disabled"}
   */
  static connectionStateOf(app) {
    if (!app.active) {
      return CONNECTION_STATES.DISABLED;
    }
    const lastTest = app.lastTest;
    if (
      !lastTest?.fingerprint ||
      lastTest.fingerprint !==
        createAccessApplication({ ...app }).connectionFingerprint()
    ) {
      return CONNECTION_STATES.UNCHECKED;
    }
    return lastTest.success
      ? CONNECTION_STATES.CONNECTED
      : CONNECTION_STATES.FAILING;
  }

  /**
   * Tests the connection of a provider with the configuration the admin
   * form sends, stored secrets taken for empty ones (`completeSecrets`,
   * from the application read once under the route's reach), and records the test at the provider's stored application:
   * result, time, error message and the fingerprint of the tested values.
   * Without a stored application nothing is recorded. A test that throws
   * is recorded as failed and rethrown.
   *
   * @param {string} tenantId
   * @param {string} providerId
   * @param {Object} config The configuration as the admin form sent it
   * @param {{reach: string, userId?: string|null}} scope The route's reach
   * @returns {Promise<Object>} The provider's test answer
   */
  static async testConnection(tenantId, providerId, config, scope) {
    const tenant = await AccessAppLifecycleService._tenantOf(tenantId, scope);
    const stored = findAccessApp(tenant, providerId);
    const secrets = completeSecrets(providerId, config || {}, stored);
    const record = (success, error) =>
      stored
        ? TenantManager.recordAccessTest(tenantId, providerId, {
            success,
            testedAt: Date.now(),
            error: success ? null : error || null,
            fingerprint: createAccessApplication({
              ...secrets.config,
              type: ACCESS_APP_TYPE,
              id: providerId,
            }).connectionFingerprint(),
          })
        : Promise.resolve();

    let result;
    try {
      result = await AccessInfoService.testConnection(providerId, config, {
        tenantId,
        secrets,
      });
    } catch (err) {
      await record(false, TEST_THREW);
      throw err;
    }

    await record(!!result?.success, result?.message);
    return result;
  }

  /**
   * Saves the access application of one provider (glossary "Anbindung"):
   * creates it, switched on, or changes the stored one, and nothing else of
   * the tenant. What the request leaves out stays as stored; a secret it
   * leaves empty too, as long as the identity it belongs to stays - the
   * rule of the connection test (`completeSecrets`, `secretIdentity`). A
   * stored secret whose identity changed is not kept: the save is refused
   * and nothing is stored. Whether the application is switched on is not
   * the save's to change (`setActive`), nor is the backend-owned state
   * (`preserveBackendState`).
   *
   * @param {string} tenantId
   * @param {string} providerId
   * @param {Object} fields The application as the admin form sends it
   * @param {{reach: string, userId?: string|null}} scope The route's reach
   * @returns {Promise<Object>} The saved application as `exportApplication`
   * @throws {BadRequestError} `missing_secret` with `{ provider, missing:
   *   [{ field, reason }] }`, `reason` as at the connection test (e.g.
   *   `server_url_changed`)
   * @throws {NotFoundError} `access_provider_not_found`, `tenant_not_found`
   */
  static async saveApplication(tenantId, providerId, fields, scope) {
    AccessAppLifecycleService._assertProvider(providerId);
    const tenant = await AccessAppLifecycleService._tenantOf(tenantId, scope);
    const stored = findAccessApp(tenant, providerId);

    const app = createAccessApplication({
      ...stored,
      ...fields,
      type: ACCESS_APP_TYPE,
      id: providerId,
      active: stored ? stored.active : true,
    });
    const keptSecrets = AccessAppLifecycleService._keptSecrets(
      providerId,
      app,
      fields,
      stored,
    );
    Object.assign(app, keptSecrets);
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
   * An access application as it leaves through the API, as a copy: without
   * its secrets - per secret field `storedSecrets` says whether one is
   * stored -, without the Salto KS IQ activations, which never leave, not
   * even encrypted: whoever holds their OTP ingredients can open every door
   * of the IQ (`preserveBackendState` keeps them on a write); with its
   * connection state and the last test without its fingerprint.
   *
   * @param {Object} app The stored application, secrets in plain text
   * @returns {Object}
   */
  static exportApplication(app) {
    const exported = {
      ...app,
      connectionState: AccessAppLifecycleService.connectionStateOf(app),
      lastTest: AccessAppLifecycleService._exportLastTest(app.lastTest),
    };
    delete exported.iqActivations;
    const storedSecrets = {};
    for (const field of secretFieldsOf(app.id)) {
      storedSecrets[field] = !isEmpty(exported[field]);
      delete exported[field];
    }
    return { ...exported, storedSecrets };
  }

  /**
   * @private
   * The last test as it leaves through the API: without its fingerprint.
   */
  static _exportLastTest(lastTest) {
    if (!lastTest) {
      return null;
    }
    return {
      success: !!lastTest.success,
      testedAt: lastTest.testedAt ?? null,
      error: lastTest.error ?? null,
    };
  }

  /**
   * @private
   * The secrets a save keeps from the stored application: every one the
   * request leaves empty, null where none is stored.
   *
   * @throws {BadRequestError} `missing_secret` for a stored secret the
   *   request leaves empty while its identity changes
   */
  static _keptSecrets(providerId, app, fields, stored) {
    const leftEmpty = secretFieldsOf(providerId).filter((field) =>
      isEmpty(fields?.[field]),
    );
    const sent = { ...app };
    for (const field of leftEmpty) {
      sent[field] = null;
    }

    const { config, missing } = completeSecrets(providerId, sent, stored);
    const changed = missing.filter(({ reason }) => reason !== "not_stored");
    if (changed.length > 0) {
      throw new BadRequestError("missing_secret", {
        provider: providerId,
        missing: changed,
      });
    }

    return Object.fromEntries(
      leftEmpty.map((field) => [field, config[field] ?? null]),
    );
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
    const stored = findAccessApp(tenant, providerId);
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
    const app = findAccessApp(tenant, providerId);
    if (!app?.active) {
      return null;
    }

    return app.webhookSecret || app.notificationSecret || null;
  }
}

module.exports = AccessAppLifecycleService;
