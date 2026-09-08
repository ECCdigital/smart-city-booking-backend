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
const LIST_ACCESS_POINTS_CAPABILITY = "listAccessPoints";

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

  /**
   * The access modes the provider reports for an access point - what the
   * hardware can do, as opposed to the `mode` an administrator configured
   * for it.
   *
   * The provider's access point is resolved by `externalId` against what the
   * provider lists for the tenant, matched against the `id` of a listed entry
   * as well as its `externalId`: providers name their access points either
   * way. The listing is used rather than the provider's own
   * `getSupportedModes` capability - which asks about a single access point
   * and is what the provisioning path uses - because an access point the
   * provider does not know has to come back as "no answer" here, not as the
   * error a direct lookup would raise. Same question and same argument order
   * as that capability, so the two differ only in whom they ask.
   *
   * Everything unknown is answered with `null` rather than an empty list, so a
   * caller can tell "this access point cannot do that" from "the provider does
   * not say". A provider that cannot list its access points, an access point
   * without an `externalId`, one the provider does not list and one listed
   * without `supportedModes` all end up here.
   *
   * @param {Object} accessPoint The access point, read for `provider` and
   *   `externalId`
   * @param {string} tenantId Tenant the access point belongs to
   * @returns {Promise<string[]|null>} The modes the provider reports, or
   *   `null` when it reports none
   */
  static async getSupportedModes(accessPoint, tenantId) {
    const capabilities = getAccessProviderCapabilities(accessPoint.provider);

    if (
      !capabilities.includes(LIST_ACCESS_POINTS_CAPABILITY) ||
      !accessPoint.externalId
    ) {
      return null;
    }

    const providerAccessPoints = await AccessInfoService.getAccessPoints(
      tenantId,
      accessPoint.provider,
    );
    const externalId = String(accessPoint.externalId);
    const providerAccessPoint = (providerAccessPoints || []).find(
      (candidate) =>
        String(candidate.id) === externalId ||
        String(candidate.externalId) === externalId,
    );

    return Array.isArray(providerAccessPoint?.supportedModes)
      ? providerAccessPoint.supportedModes
      : null;
  }

  static async testConnection(provider, config, context = {}) {
    return testProvider(provider, config, context);
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
