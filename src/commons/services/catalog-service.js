const CatalogManager = require("../data-managers/catalog-manager");

class CatalogService {
  static async getCatalogByTenant(tenantId) {
    const catalog = await CatalogManager.getCatalogByTenant(tenantId);

    if (!catalog) {
      throw {
        code: 404,
        message: `No Catalog found for tenant ${tenantId}`,
      };
    }

    return catalog;
  }

  static async getCatalog(slug) {
    const catalog = await CatalogManager.getCatalogBySlug(slug);

    if (!catalog) {
      throw {
        code: 404,
        message: `Catalog with slug "${slug}" not found`,
      };
    }

    if (!catalog.active) {
      throw new Error(`Catalog with slug "${slug}" is not active`);
    }

    return catalog;
  }

  static async getTheme(slug) {
    const catalog = await CatalogManager.getCatalogBySlug(slug);

    if (!catalog || !catalog.theme) {
      throw new Error(`Catalog with slug "${slug}" not found`);
    }

    if (!catalog.active) {
      throw new Error(`Catalog with slug "${slug}" is not active`);
    }

    if (!catalog.theme.active) {
      throw new Error(`Theme for catalog with slug "${slug}" is not active`);
    }

    return { theme: catalog.theme, visibility: catalog.visibility };
  }

  static async updateCatalog(catalog) {
    if (!catalog || !catalog.tenantId) {
      throw new Error("Catalog data and tenant ID are required");
    }

    const updatedCatalog = await CatalogManager.updateCatalog(catalog, {
      _id: catalog._id,
    });

    if (!updatedCatalog) {
      throw new Error(
        `Failed to update catalog for tenant "${catalog.tenantId}"`,
      );
    }

    return updatedCatalog;
  }

  static async createTenantCatalog(tenantId, catalog) {
    if (!tenantId || !catalog) {
      throw new Error("Tenant ID and catalog data are required");
    }

    const sanitizedCatalog = {
      ...catalog,
      tenantId: tenantId,
      type: "single",
    };

    const existingCatalog = await CatalogManager.getCatalogByTenant(tenantId);
    if (existingCatalog) {
      throw new Error(`Catalog already exists for tenant "${tenantId}"`);
    }

    const newCatalog = await CatalogManager.createCatalog(sanitizedCatalog);

    if (!newCatalog) {
      throw new Error(`Failed to create catalog for tenant "${tenantId}"`);
    }

    return newCatalog;
  }

  static async updateTenantCatalog(tenantId, catalog) {
    if (!tenantId || !catalog) {
      throw new Error("Tenant ID and catalog data are required");
    }

    const sanitizedCatalog = {
      ...catalog,
      tenantId: tenantId,
      type: "single",
    };

    const updatedCatalog = await CatalogManager.updateCatalog(
      sanitizedCatalog,
      { _id: sanitizedCatalog._id, tenantId: tenantId },
    );

    if (!updatedCatalog) {
      throw new Error(`Failed to update catalog for tenant "${tenantId}"`);
    }

    return updatedCatalog;
  }

  static async slugAvailable(slug) {
    const catalog = await CatalogManager.getCatalogBySlug(slug);

    return !catalog;
  }
}

module.exports = CatalogService;
