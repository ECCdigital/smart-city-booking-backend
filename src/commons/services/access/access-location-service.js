const {
  getAccessProvider,
  getAccessProviderCapabilities,
} = require("./providers/access-provider-registry");

require("./providers/register-access-providers");

const GET_LOCATION_CAPABILITY = "getLocation";

/**
 * Location prefill: asks the provider of an access point where its lock
 * stands, so an admin does not have to type coordinates that the provider
 * already knows.
 *
 * The answer is a suggestion and nothing more - it is never written to the
 * access point. Adopting it into `location` is an explicit PUT by the admin,
 * which keeps the entity the single source of the location (no sync field, no
 * background reconciliation).
 */
class AccessLocationService {
  /**
   * Ask the provider of the access point for its location.
   *
   * @param {Object} accessPoint The access point to locate
   * @param {string} tenantId Tenant the access point belongs to
   * @returns {Promise<Object|null>} A `location` in the shape of
   *   `accessPoint.location`, or `null` when no location can be determined -
   *   because the provider is unknown, does not offer the optional
   *   `getLocation` capability, or knows no position for this lock
   */
  static async getLocationPrefill(accessPoint, tenantId) {
    const capabilities = getAccessProviderCapabilities(accessPoint.provider);

    if (!capabilities.includes(GET_LOCATION_CAPABILITY)) {
      return null;
    }

    const provider = getAccessProvider(accessPoint.provider);
    const location = await provider.getLocation(accessPoint, tenantId);

    return location ?? null;
  }
}

module.exports = AccessLocationService;
