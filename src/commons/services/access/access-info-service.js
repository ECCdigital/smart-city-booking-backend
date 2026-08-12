const TenantManager = require("../../data-managers/tenant-manager");
const { getCapabilities } = require("./clients/access-client-registry");
const { testProvider } = require("./clients/access-test-registry");
const {
  getAccessProvider,
  getAccessProviderCapabilities,
} = require("./providers/access-provider-registry");

require("./clients");
require("./providers/register-access-providers");

const APP_TYPE = "access";

class AccessInfoService {
  /**
   * The access providers a tenant has switched on. `capabilities` lists what
   * the provider's API client can do, `providerCapabilities` what the provider
   * itself offers - including optional ones such as `getLocation`, so a client
   * can tell beforehand whether an action like the location prefill is worth
   * offering.
   *
   * @param {string} tenantId Tenant whose providers are listed
   * @returns {Promise<Object[]>} The active providers with their `id`, `title`,
   *   `capabilities` and `providerCapabilities`
   */
  static async getActiveProviders(tenantId) {
    const tenant = await TenantManager.getTenant(tenantId);

    return (tenant?.applications || [])
      .filter((a) => a.type === APP_TYPE && a.active)
      .map((a) => ({
        id: a.id,
        title: a.title || a.id,
        capabilities: getCapabilities(a.id),
        providerCapabilities: getAccessProviderCapabilities(a.id),
      }));
  }

  static async getAccessPoints(tenantId, provider) {
    const accessProvider = getAccessProvider(provider);
    return accessProvider.listAccessPoints(tenantId);
  }

  static async testConnection(provider, config) {
    return testProvider(provider, config);
  }

  static async registerWebhook(tenantId, provider, callbackUrl) {
    const accessProvider = getAccessProvider(provider);
    return accessProvider.registerWebhook(tenantId, callbackUrl);
  }

  static async unregisterWebhook(tenantId, provider, notificationId) {
    const accessProvider = getAccessProvider(provider);
    return accessProvider.unregisterWebhook(tenantId, notificationId);
  }
}

module.exports = AccessInfoService;
