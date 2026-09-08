const { getTenantAppById } = require("../data-managers/tenant-manager");
const providerRegistry = require("./checkout/providers/register");
const { createClient } = require("./access/clients/access-client-registry");
require("./access/clients");

class ExternalPriceService {
  /**
   * Resolves external price categories for a bookable.
   * Returns null if the bookable has no external pricing.
   *
   * @param {Object} bookable
   * @param {string} tenantId
   * @param {Map} [sharedCache]
   * @returns {Promise<Object[]|null>}
   */
  static async resolve(bookable, tenantId, sharedCache = new Map()) {
    if (!bookable.hasExternalPricing) return null;

    const declarations = (bookable.externalProviders || []).filter((d) =>
      d.handles.includes("pricing"),
    );

    if (!declarations.length) return null;

    const categories = [];

    for (const decl of declarations) {
      const external = await this.categoriesOf(
        tenantId,
        decl.provider,
        decl.config,
        { bookable, sharedCache },
      );
      if (external) {
        categories.push(...external);
      }
    }

    return categories.length > 0 ? categories : null;
  }

  /**
   * The price categories one checkout price provider answers for a
   * configuration - an iFBS location, say - with the tenant's application
   * of the provider.
   *
   * @param {string} tenantId
   * @param {string} provider The checkout provider, e.g. `ifbs`
   * @param {Object} config What the provider prices, as `externalProviders[].config`
   *   declares it
   * @param {Object} [options]
   * @param {Object} [options.bookable={}] The bookable priced, where there is one
   * @param {Map} [options.sharedCache] Cache shared across calls
   * @returns {Promise<Object[]|null>} The categories, `[]` where the provider
   *   answers none, `null` where there is no such provider or the tenant
   *   has no active application for it
   */
  static async categoriesOf(
    tenantId,
    provider,
    config,
    { bookable = {}, sharedCache = new Map() } = {},
  ) {
    if (!providerRegistry.has(provider)) return null;

    const app = await getTenantAppById(tenantId, provider);
    if (!app?.active) return null;

    const client = createClient(app);

    const checkoutProvider = providerRegistry.resolve(provider, client, {
      bookable,
      unit: config,
      tenantId,
      externalCache: sharedCache,
    });

    if (typeof checkoutProvider.getExternalPriceCategories !== "function") {
      return [];
    }

    return checkoutProvider.getExternalPriceCategories();
  }
}

module.exports = ExternalPriceService;
