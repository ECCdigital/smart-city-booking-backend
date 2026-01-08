const CatalogManager = require("../data-managers/catalog-manager");
const TenantManager = require("../data-managers/tenant-manager");

class CatalogService {
  static async getInstanceCatalog() {
    const catalog = await CatalogManager.getInstanceCatalog();

    if (!catalog) {
      throw {
        code: 404,
        message: "No Instance Catalog found",
      };
    }

    return catalog;
  }

  static async getCatalogBundle(tenantId = null) {
    if (!tenantId) {
      const catalog = await CatalogManager.getInstanceCatalog();

      if (!catalog) {
        throw {
          code: 404,
          message: "No Instance Catalog found",
        };
      }

      const tenants = await TenantManager.getTenants();

      const allowedTenants = tenants.filter((tenant) => {
        if (tenant.catalogParticipation.visible) {
          return !catalog.excludedTenantIds.includes(tenant.id);
        }
      });

      return {
        catalog: catalog.exportPublic(),
        tenants: allowedTenants.map((tenant) => {
          return { id: tenant.id, name: tenant.name };
        }),
      };
    }
  }

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

  static async getThemeBySlug(slug) {
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

  static async getTheme() {
    const catalog = await CatalogManager.getInstanceCatalog();

    if (!catalog) {
      throw new Error(`Instance catalog or its theme not found`);
    }
    if (!catalog.theme.active) {
      throw new Error(`Theme for instance catalog is not active`);
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

  static async createInstanceCatalog(catalog) {
    if (!catalog) {
      throw new Error("Catalog data is required");
    }

    const sanitizedCatalog = {
      ...catalog,
      type: "instance",
    };

    const existingCatalog = await CatalogManager.getInstanceCatalog();
    if (existingCatalog) {
      throw new Error("Instance catalog already exists");
    }

    const newCatalog = await CatalogManager.createCatalog(sanitizedCatalog);

    if (!newCatalog) {
      throw new Error("Failed to create instance catalog");
    }

    return newCatalog;
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

  static async updateInstanceCatalog(catalog) {
    if (!catalog) {
      throw new Error("Catalog data is required");
    }

    const updatedCatalog = await CatalogManager.updateCatalog(catalog, {
      _id: catalog._id,
      type: "instance",
    });

    if (!updatedCatalog) {
      throw new Error(`Failed to update instance catalog`);
    }

    return updatedCatalog;
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
