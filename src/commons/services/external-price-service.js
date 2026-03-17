const { getTenantAppById } = require("../data-managers/tenant-manager");
const providerRegistry = require("./checkout/providers/checkout-provider-registry");
const { createClient } = require("./locker/clients/locker-client-registry");

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
      if (!providerRegistry.has(decl.provider)) continue;

      const app = await getTenantAppById(tenantId, decl.provider);
      if (!app?.active) continue;

      const client = createClient(app);

      const provider = providerRegistry.resolve(decl.provider, client, {
        bookable,
        unit: decl.config,
        tenantId,
        externalCache: sharedCache,
      });

      if (typeof provider.getExternalPriceCategories === "function") {
        const extCats = await provider.getExternalPriceCategories();
        categories.push(...extCats);
      }
    }

    return categories.length > 0 ? categories : null;
  }
}

module.exports = ExternalPriceService;
