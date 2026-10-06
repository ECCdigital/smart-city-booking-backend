const TenantManager = require("../../data-managers/tenant-manager");
const { getCapabilities } = require("./clients/access-client-registry");
const { testProvider } = require("./clients/access-test-registry");
const {
  getAccessProvider,
  getAccessProviderCapabilities,
} = require("./providers/access-provider-registry");
const { DOMAIN } = require("../authorization/reach");

require("./clients");
require("./providers/register-access-providers");

const APP_TYPE = "access";
const LIST_ACCESS_POINTS_CAPABILITY = "listAccessPoints";
const VALIDATE_ACCESS_POINT_CAPABILITY = "validateAccessPoint";

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
    const tenant = await TenantManager.getTenant(tenantId, DOMAIN);

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
   * The entry the provider lists for an access point - the one the admin UI
   * picks from, with the provider's raw `metadata` on it.
   *
   * The provider's access point is resolved by `externalId` against what the
   * provider lists for the tenant, matched against the `id` of a listed entry
   * as well as its `externalId`: providers name their access points either
   * way. The listing is used rather than the provider's per-point
   * capabilities - which ask about a single access point and are what the
   * provisioning path uses - because an access point the provider does not
   * know has to come back as "no answer" here, not as the error a direct
   * lookup would raise.
   *
   * Everything unknown is answered with `null`: a provider that cannot list
   * its access points, an access point without an `externalId` and one the
   * provider does not list. A provider that fails to answer is not an
   * unlisted access point - its error passes through untouched.
   *
   * @param {Object} accessPoint The access point, read for `provider` and
   *   `externalId`
   * @param {string} tenantId Tenant the access point belongs to
   * @returns {Promise<Object|null>} The listed entry, or `null` when the
   *   provider does not list the access point
   */
  static async findListedAccessPoint(accessPoint, tenantId) {
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

    return (
      (providerAccessPoints || []).find(
        (candidate) =>
          String(candidate.id) === externalId ||
          String(candidate.externalId) === externalId,
      ) || null
    );
  }

  /**
   * The access modes a listed entry reports - the one place that decides
   * what counts as an answer. Answered with `null` rather than an empty
   * list wherever the provider does not say, so a caller can tell "this
   * access point cannot do that" from "the provider does not say": an
   * unlisted access point (`null` entry) and one listed without
   * `supportedModes` both end up here.
   *
   * @param {Object|null} listedAccessPoint An entry of `listAccessPoints`,
   *   `null` when the provider does not list the access point
   * @returns {string[]|null} The modes the entry reports, or `null` when it
   *   reports none
   */
  static supportedModesOf(listedAccessPoint) {
    return Array.isArray(listedAccessPoint?.supportedModes)
      ? listedAccessPoint.supportedModes
      : null;
  }

  /**
   * The access modes the provider reports for an access point - what the
   * hardware can do, as opposed to the `mode` an administrator configured
   * for it. Read off the listed entry (see `findListedAccessPoint`), so the
   * same question and argument order as the provider's own
   * `getSupportedModes` capability, differing only in whom they ask.
   *
   * @param {Object} accessPoint The access point, read for `provider` and
   *   `externalId`
   * @param {string} tenantId Tenant the access point belongs to
   * @returns {Promise<string[]|null>} The modes the provider reports, or
   *   `null` when it reports none
   */
  static async getSupportedModes(accessPoint, tenantId) {
    return AccessInfoService.supportedModesOf(
      await AccessInfoService.findListedAccessPoint(accessPoint, tenantId),
    );
  }

  /**
   * Let the provider refuse an access point it cannot honour, before it is
   * stored - a `config.openAction` the Nuki device cannot carry out, say.
   * Optional capability: a provider that does not declare
   * `validateAccessPoint` has no say and the access point passes.
   *
   * The provider's listed entry is handed in rather than fetched (see
   * `findListedAccessPoint`), so a save costs one provider round trip
   * however many checks read it.
   *
   * @param {Object} accessPoint The access point as it would be stored
   * @param {Object|null} listedAccessPoint The provider's listed entry for
   *   it, `null` when the provider does not list it
   * @returns {void}
   * @throws {ValidationError} What the provider will not store
   */
  static validateAccessPoint(accessPoint, listedAccessPoint) {
    const capabilities = getAccessProviderCapabilities(accessPoint.provider);

    if (!capabilities.includes(VALIDATE_ACCESS_POINT_CAPABILITY)) {
      return;
    }

    getAccessProvider(accessPoint.provider).validateAccessPoint(
      accessPoint,
      listedAccessPoint,
    );
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
