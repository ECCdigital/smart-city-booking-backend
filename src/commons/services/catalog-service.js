const CatalogManager = require("../data-managers/catalog-manager");
const TenantManager = require("../data-managers/tenant-manager");
const InstanceManager = require("../data-managers/instance-manager");
const {
  getMemberTenantIds,
  isTenantListedInCatalog,
} = require("../utilities/catalog-participation-utils");
const { ThemeExportCache } = require("./catalog/theme-export-cache");
const {
  exportBackground,
  exportHeroLayout,
} = require("./hero-layout/hero-export");
const { enrichHeroMediaReference } = require("./hero-layout/hero-media");
const { normalizeHeroLayout } = require("./hero-layout/hero-layout-schema");
const {
  exportHeroEditorState,
  normalizeHeroEditorBody,
} = require("./hero-layout/hero-editor");
const {
  HeroValidationErrors,
  carries,
} = require("./hero-layout/hero-validation");
const { portalNameOf } = require("./hero-layout/hero-default-layout");
const SchemaUtils = require("../utilities/schemaUtils");
const {
  BadRequestError,
  ConflictError,
  NotFoundError,
} = require("../../errors/BaseError");
const { ValidationError } = require("../../errors/ValidationError");

const ERROR_CODES = SchemaUtils.ERROR_CODES;

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

/**
 * The Background the Theme Bundle delivers. It sits inside the branding and
 * follows its `active` flag, like the theme colours and the logo: a switched-off
 * branding hands the storefront its default look, and the default Background is
 * part of that.
 *
 * @param {?Object} branding - The instance branding.
 * @returns {?Object} The stored Background, or null for the default.
 */
function activeBackground(branding) {
  return branding?.active ? branding.background ?? null : null;
}

/**
 * The logo the Theme Bundle delivers and the Default Hero Layout is derived
 * with. Like `logoUrl` and the Background it follows `branding.active`: a
 * switched-off branding hands the storefront its default look, without a
 * logo.
 *
 * @param {?Object} branding - The instance branding, as `getBranding` reads it.
 * @returns {?Object} The logo reference, or null.
 */
function activeLogo(branding) {
  return branding?.active ? branding.logo ?? null : null;
}

/**
 * The Theme Bundle of one Catalog (hero-layout spec, Shared contract): the
 * exported branding and, on every bundle, the Portal Name, the Hero Layout
 * (stored or the derived default), the Background and the logo, media
 * references enriched. A slug catalog's `name` stands where the Portal Name
 * does for the instance catalog.
 *
 * @param {?Object} catalog - The Catalog, or null for an instance without one.
 * @param {?Object} branding - The instance branding.
 * @returns {Promise<Object>} The bundle.
 */
async function exportTheme(catalog, branding) {
  const name = catalog?.name ?? "";
  const logo = activeLogo(branding);

  const [heroLayout, background, exportedLogo] = await Promise.all([
    exportHeroLayout(catalog?.heroLayout ?? null, { name, logo }),
    exportBackground(activeBackground(branding)),
    enrichHeroMediaReference(logo),
  ]);

  return {
    ...exportBranding(branding),
    name,
    heroLayout,
    background,
    logo: exportedLogo,
    visibility: catalog?.visibility ?? "public",
  };
}

/**
 * Refuses what a tenant catalog write does not take. The Hero Layout lives on
 * the instance catalog; a tenant catalog joins it only with a future
 * slug-catalog effort.
 *
 * @param {Object} catalog - The catalog body being written.
 * @throws {ValidationError} With the detail at its JSON path.
 */
function assertTenantCatalogWritable(catalog) {
  if (carries(catalog, "heroLayout")) {
    throw new ValidationError([
      { field: "heroLayout", code: ERROR_CODES.unknownField },
    ]);
  }
}

/**
 * Reads the instance catalog body into the form it is stored in. Its `name` is
 * the Portal Name - browser title, Default Hero Layout title, auth pages - so
 * an empty one is refused here; the mongoose `required` stays as it is so
 * documents from before stay readable. A body that names `heroLayout` has it normalised into
 * its stored form, with `null` resetting to the Default Hero Layout; a body
 * that does not name it leaves the stored layout alone.
 *
 * The faults of both are answered together, in body order, so an admin who
 * saves a nameless catalog with a broken Block sees both at once.
 *
 * @param {Object} catalog - The catalog body being written.
 * @returns {Promise<Object>} The body as it is stored.
 * @throws {ValidationError} One detail per fault, JSON paths as fields.
 */
async function normalizeInstanceCatalogWrite(catalog) {
  const errors = new HeroValidationErrors();

  if (!portalNameOf(catalog.name)) {
    errors.add("name", ERROR_CODES.required);
  }

  const carriesHeroLayout = carries(catalog, "heroLayout");
  let heroLayout;

  if (carriesHeroLayout) {
    try {
      heroLayout = await normalizeHeroLayout(catalog.heroLayout);
    } catch (error) {
      errors.absorb(error);
    }
  }

  errors.throwIfAny();

  return carriesHeroLayout ? { ...catalog, heroLayout } : catalog;
}

/**
 * The Portal Name a preview is rendered with: the one the body carries, or the
 * stored one. An instance without a catalog previews with none — the preview
 * writes nothing, so there is nothing to refuse.
 *
 * @param {Object} body - The preview body.
 * @returns {Promise<string>} The Portal Name.
 */
async function previewPortalName(body) {
  if (typeof body?.name === "string") {
    return body.name;
  }

  const catalog = await CatalogManager.getInstanceCatalog();

  return catalog?.name ?? "";
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

    return exportTheme(catalog, branding);
  }

  static async getTheme() {
    const [catalog, branding] = await Promise.all([
      CatalogManager.getInstanceCatalog(),
      InstanceManager.getBranding(),
    ]);

    return exportTheme(catalog, branding);
  }

  /**
   * The Theme Bundle with the tag it is revalidated against, from the theme
   * export cache. The visibility of a slug catalog is decided by the caller
   * before this runs: the cache holds the bundle, never the permission.
   *
   * @param {?string} [slug] - Slug catalog, or nothing for the instance.
   * @returns {Promise<{body: Object, etag: string}>} Bundle and its tag.
   */
  static async getThemeExport(slug = null) {
    return ThemeExportCache.remember(ThemeExportCache.keyFor(slug), () =>
      slug ? CatalogService.getThemeBySlug(slug) : CatalogService.getTheme(),
    );
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

    assertTenantCatalogWritable(catalog);

    const updatedCatalog = await CatalogManager.updateCatalog(catalog, {
      _id: catalog._id,
    });

    if (!updatedCatalog) {
      throw new NotFoundError("catalog_not_found", {
        tenantId: catalog.tenantId,
      });
    }

    ThemeExportCache.invalidateAll();

    return updatedCatalog;
  }

  static async createInstanceCatalog(catalog) {
    if (!catalog) {
      throw new BadRequestError("catalog_required");
    }

    const sanitizedCatalog = {
      ...(await normalizeInstanceCatalogWrite(catalog)),
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

    ThemeExportCache.invalidateAll();

    return newCatalog;
  }

  static async createTenantCatalog(tenantId, catalog) {
    if (!tenantId || !catalog) {
      throw new BadRequestError("catalog_tenant_required");
    }

    assertTenantCatalogWritable(catalog);

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

    ThemeExportCache.invalidateAll();

    return newCatalog;
  }

  static async updateInstanceCatalog(catalog) {
    if (!catalog) {
      throw new BadRequestError("catalog_required");
    }

    const updatedCatalog = await CatalogManager.updateCatalog(
      await normalizeInstanceCatalogWrite(catalog),
      { _id: catalog._id, type: "instance" },
    );

    if (!updatedCatalog) {
      throw new NotFoundError("instance_catalog_not_found");
    }

    ThemeExportCache.invalidateAll();

    return updatedCatalog;
  }

  static async updateTenantCatalog(tenantId, catalog) {
    if (!tenantId || !catalog) {
      throw new BadRequestError("catalog_tenant_required");
    }

    assertTenantCatalogWritable(catalog);

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

    ThemeExportCache.invalidateAll();

    return updatedCatalog;
  }

  /**
   * What the Hero Editor reads (hero-layout spec §4): the Hero Layout, the
   * Background and the Portal Name in export form, and whether the two objects
   * are derived rather than stored — the state the editor's reset to default
   * lands on.
   *
   * The two objects the editor writes back are read as they are stored, not as
   * the Theme Bundle delivers them: the bundle hides a stored Background behind
   * `branding.active`, and an editor that showed the default there would offer
   * to overwrite what is stored. The logo is only an input to the derived
   * default and follows `branding.active` as it does everywhere else, so a
   * saved default never paints a logo the header does not show.
   *
   * @returns {Promise<Object>} `{ heroLayout, background, name, isDefault }`.
   * @throws {NotFoundError} Without an instance catalog to edit.
   */
  static async getHeroLayout() {
    const [catalog, branding] = await Promise.all([
      CatalogService.getInstanceCatalog(),
      InstanceManager.getBranding(),
    ]);

    const heroLayout = catalog.heroLayout ?? null;
    const background = branding?.background ?? null;

    return {
      ...(await exportHeroEditorState({
        heroLayout,
        background,
        name: catalog.name,
        logo: activeLogo(branding),
      })),
      isDefault: heroLayout === null && background === null,
    };
  }

  /**
   * The Hero Editor's save (hero-layout spec §4). Both objects are validated
   * before anything is written, then the Catalog takes the layout, then the
   * instance takes the Background, then the theme export cache is flushed once
   * for both. There is no transaction: only an infrastructure failure between
   * the two writes can split them, and saving again heals it.
   *
   * The Portal Name is not written here — it belongs to the general settings —
   * but it is answered, because the derived default layout is built from it.
   *
   * @param {Object} body - `{ heroLayout, background }`, `null` each resetting
   *   to the derived default.
   * @returns {Promise<Object>} `{ heroLayout, background, name }` in export form.
   * @throws {ValidationError} With one detail per fault of either object.
   * @throws {NotFoundError} Without an instance catalog to write.
   */
  static async updateHeroLayout(body) {
    const { heroLayout, background } = await normalizeHeroEditorBody(body);

    // Only the layout is written, and only onto the one instance catalog:
    // everything else on that document belongs to the general settings.
    const catalog = await CatalogManager.updateCatalog(
      { heroLayout },
      { type: "instance" },
    );

    if (!catalog) {
      throw new NotFoundError("instance_catalog_not_found");
    }

    await InstanceManager.updateBackground(background);

    ThemeExportCache.invalidateAll();

    const branding = await InstanceManager.getBranding();

    return exportHeroEditorState({
      heroLayout,
      background,
      name: catalog.name,
      logo: activeLogo(branding),
    });
  }

  /**
   * What the Live Preview and the editor's reset to default read (hero-layout
   * spec §4): the same normaliser, sanitiser and enrichment as the save, and
   * the same answer, without writing anything and without flushing anything.
   *
   * The `name` of the body is the Portal Name the derived default layout is
   * built from, so the editor can preview a name it has not saved yet; a body
   * that names none falls back to the stored one.
   *
   * @param {Object} body - `{ heroLayout, background, name }`.
   * @returns {Promise<Object>} `{ heroLayout, background, name }` in export form.
   * @throws {ValidationError} With one detail per fault of either object.
   */
  static async previewHeroLayout(body) {
    const { heroLayout, background } = await normalizeHeroEditorBody(body);

    const [branding, name] = await Promise.all([
      InstanceManager.getBranding(),
      previewPortalName(body),
    ]);

    return exportHeroEditorState({
      heroLayout,
      background,
      name,
      logo: activeLogo(branding),
    });
  }

  static async slugAvailable(slug) {
    const catalog = await CatalogManager.getCatalogBySlug(slug);

    return !catalog;
  }
}

module.exports = CatalogService;
