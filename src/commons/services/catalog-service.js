const CatalogManager = require("../data-managers/catalog-manager");
const TenantManager = require("../data-managers/tenant-manager");
const InstanceManager = require("../data-managers/instance-manager");
const {
  getMemberTenantIds,
  isTenantListedInCatalog,
} = require("../utilities/catalog-participation-utils");
const {
  BadRequestError,
  ConflictError,
  NotFoundError,
} = require("../../errors/BaseError");

const DEFAULT_HERO = Object.freeze({ title: "", subtitle: "" });

/**
 * Erstellt eine an Clients ausgelieferte Variante des Brandings.
 * Bei `branding.active === false` werden weder `theme` noch `logoUrl`/
 * `faviconUrl` ausgeliefert (jeweils `null`), damit das Frontend bewusst
 * auf seine Default-Optik (Logo, Favicon, Theme) zurückfällt.
 */
function exportBranding(branding) {
  if (!branding?.active) {
    return {
      active: false,
      theme: null,
      logoUrl: null,
      faviconUrl: null,
    };
  }
  return {
    active: true,
    logoUrl: branding.logoUrl ?? "",
    faviconUrl: branding.faviconUrl ?? "",
    theme: branding.theme ?? null,
  };
}

class CatalogService {
  static async getInstanceCatalog() {
    const catalog = await CatalogManager.getInstanceCatalog();

    if (!catalog) {
      throw new NotFoundError("instance_catalog_not_found");
    }

    return catalog;
  }

  static async getCatalogBundle(tenantId = null, userId = null) {
    if (!tenantId) {
      const [catalog, portal, branding] = await Promise.all([
        CatalogManager.getInstanceCatalog(),
        InstanceManager.getPortalConfig(),
        InstanceManager.getBranding(),
      ]);

      if (!catalog) {
        throw new NotFoundError("instance_catalog_not_found");
      }

      if (!portal.publicOffersEnabled) {
        return {
          offersEnabled: false,
          branding: exportBranding(branding),
          portalUrl: portal.portalUrl,
          catalog: catalog.exportPublic(),
          tenants: [],
        };
      }

      const [tenants, memberTenantIds] = await Promise.all([
        TenantManager.getTenants(),
        getMemberTenantIds(userId),
      ]);

      const allowedTenants = tenants.filter((tenant) =>
        isTenantListedInCatalog(tenant, catalog, memberTenantIds),
      );

      return {
        offersEnabled: true,
        branding: exportBranding(branding),
        portalUrl: portal.portalUrl,
        catalog: catalog.exportPublic(),
        tenants: allowedTenants.map((tenant) => {
          return {
            id: tenant.id,
            name: tenant.name,
            contactName: tenant.contactName,
            mail: tenant.mail,
            phone: tenant.phone,
          };
        }),
      };
    }
  }

  static async getCatalogByTenant(tenantId) {
    const catalog = await CatalogManager.getCatalogByTenant(tenantId);

    if (!catalog) {
      throw new NotFoundError("catalog_not_found", { tenantId });
    }

    return catalog;
  }

  static async getCatalog(slug) {
    const catalog = await CatalogManager.getCatalogBySlug(slug);

    if (!catalog) {
      throw new NotFoundError("catalog_not_found", { slug });
    }

    if (!catalog.active) {
      throw new NotFoundError("catalog_not_active", { slug });
    }

    return catalog;
  }

  static async getThemeBySlug(slug) {
    const [catalog, branding] = await Promise.all([
      CatalogManager.getCatalogBySlug(slug),
      InstanceManager.getBranding(),
    ]);

    if (!catalog) {
      throw new NotFoundError("catalog_not_found", { slug });
    }

    const exported = exportBranding(branding);
    return {
      ...exported,
      hero: catalog.hero ?? DEFAULT_HERO,
      visibility: catalog.visibility,
    };
  }

  static async getTheme() {
    const [catalog, branding] = await Promise.all([
      CatalogManager.getInstanceCatalog(),
      InstanceManager.getBranding(),
    ]);

    const exported = exportBranding(branding);
    return {
      ...exported,
      hero: catalog?.hero ?? DEFAULT_HERO,
      visibility: catalog?.visibility ?? "public",
    };
  }

  static async getBranding() {
    const branding = await InstanceManager.getBranding();
    return exportBranding(branding);
  }

  static async getPortalMode() {
    const [portal, branding] = await Promise.all([
      InstanceManager.getPortalConfig(),
      InstanceManager.getBranding(),
    ]);

    return {
      mode: portal.publicOffersEnabled ? "offers" : "personal",
      portalUrl: portal.portalUrl,
      branding: exportBranding(branding),
    };
  }

  static async updateCatalog(catalog) {
    if (!catalog || !catalog.tenantId) {
      throw new BadRequestError("catalog_tenant_required");
    }

    const updatedCatalog = await CatalogManager.updateCatalog(catalog, {
      _id: catalog._id,
    });

    if (!updatedCatalog) {
      throw new NotFoundError("catalog_not_found", {
        tenantId: catalog.tenantId,
      });
    }

    return updatedCatalog;
  }

  static async createInstanceCatalog(catalog) {
    if (!catalog) {
      throw new BadRequestError("catalog_required");
    }

    const sanitizedCatalog = {
      ...catalog,
      type: "instance",
    };

    const existingCatalog = await CatalogManager.getInstanceCatalog();
    if (existingCatalog) {
      throw new ConflictError("instance_catalog_exists");
    }

    const newCatalog = await CatalogManager.createCatalog(sanitizedCatalog);

    if (!newCatalog) {
      throw new Error("Failed to create instance catalog");
    }

    return newCatalog;
  }

  static async createTenantCatalog(tenantId, catalog) {
    if (!tenantId || !catalog) {
      throw new BadRequestError("catalog_tenant_required");
    }

    const sanitizedCatalog = {
      ...catalog,
      tenantId: tenantId,
      type: "single",
    };

    const existingCatalog = await CatalogManager.getCatalogByTenant(tenantId);
    if (existingCatalog) {
      throw new ConflictError("catalog_exists", { tenantId });
    }

    const newCatalog = await CatalogManager.createCatalog(sanitizedCatalog);

    if (!newCatalog) {
      throw new Error(`Failed to create catalog for tenant "${tenantId}"`);
    }

    return newCatalog;
  }

  static async updateInstanceCatalog(catalog) {
    if (!catalog) {
      throw new BadRequestError("catalog_required");
    }

    const updatedCatalog = await CatalogManager.updateCatalog(catalog, {
      _id: catalog._id,
      type: "instance",
    });

    if (!updatedCatalog) {
      throw new NotFoundError("instance_catalog_not_found");
    }

    return updatedCatalog;
  }

  static async updateTenantCatalog(tenantId, catalog) {
    if (!tenantId || !catalog) {
      throw new BadRequestError("catalog_tenant_required");
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
      throw new NotFoundError("catalog_not_found", { tenantId });
    }

    return updatedCatalog;
  }

  static async slugAvailable(slug) {
    const catalog = await CatalogManager.getCatalogBySlug(slug);

    return !catalog;
  }
}

module.exports = CatalogService;
