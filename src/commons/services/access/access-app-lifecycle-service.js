const TenantManager = require("../../data-managers/tenant-manager");
const { DOMAIN } = require("../authorization/reach");

const APP_TYPE = "access";

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
