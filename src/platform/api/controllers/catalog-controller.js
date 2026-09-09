const CatalogService = require("../../../commons/services/catalog-service");
const bunyan = require("bunyan");
const InstanceManager = require("../../../commons/data-managers/instance-manager");
const { scopeFor } = require("../../../commons/services/authorization");
const {
  BaseError,
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
} = require("../../../errors/BaseError");
const {
  authenticateIfNeeded,
} = require("../../../commons/utilities/auth-utils");
const ApiResponse = require("../../../commons/utilities/api-response");
const {
  assertCatalogSlugAccess,
} = require("../../../commons/utilities/catalog-participation-utils");

const logger = bunyan.createLogger({
  name: "catalog-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Whether the client's `If-None-Match` names the tag of the answer. The
 * header is a list of tags; a `W/` prefix is dropped before comparing, so a
 * proxy that weakened the tag still revalidates, and `*` matches any tag.
 *
 * @param {?string} header - The raw `If-None-Match` header, if sent.
 * @param {string} etag - The strong tag of the answer.
 * @returns {boolean} True when the client already holds this body.
 */
function matchesEntityTag(header, etag) {
  if (!header) {
    return false;
  }

  return header
    .split(",")
    .map((candidate) => candidate.trim().replace(/^W\//, ""))
    .some((candidate) => candidate === "*" || candidate === etag);
}

/**
 * The catalog handlers run on the async router: they throw the errors of
 * the errors module and the central error handler answers them. Nothing
 * here collapses an error into a body of its own.
 */
class CatalogController {
  // The instance catalog: the right is the router's (`instanceCatalog.read`,
  // `instanceCatalog.store`: the instance owner).
  static async getInstanceCatalog(request, response) {
    const catalog = await CatalogService.getInstanceCatalog();

    response.status(200).send(catalog);
  }

  static async getPublicCatalog(request, response) {
    const catalog = await CatalogService.getInstanceCatalog();

    response.status(200).send(catalog);
  }

  static async getCatalogBundle(request, response) {
    const bundle = await CatalogService.getCatalogBundle(
      null,
      request.user?.id,
    );

    // Wenn Offers deaktiviert sind, gibt das Bundle nur Branding + Modus zurück.
    // Visibility-Prüfung greift nur für den Offers-Modus.
    if (
      bundle.offersEnabled &&
      bundle.catalog?.visibility === "private" &&
      !request.user
    ) {
      throw new UnauthorizedError("authentication_required");
    }

    response.status(200).send(bundle);
  }

  /**
   * Liefert dem Frontend den aktuellen Portal-Modus inkl. Branding. Wird vom
   * Catalog-Frontend bei jedem Page-Load als Routing-Hint gelesen.
   */
  static async getPortalMode(request, response) {
    const mode = await CatalogService.getPortalMode();
    response.status(200).send(mode);
  }

  // The tenant catalog: the right is the router's (`tenant.catalog`: the
  // tenant owner).
  static async getCatalogByTenant(request, response) {
    const tenantId = request.params.tenant;

    logger.info(
      `Sending catalog for tenant ${tenantId} to user ${request.user?.id} with details`,
    );

    const catalog = await CatalogService.getCatalogByTenant(tenantId);

    response.status(200).send(catalog);
  }

  static async getCatalogBySlug(request, response) {
    const slug = request.params.slug;

    const { publicOffersEnabled } = await InstanceManager.getPortalConfig();

    // Wenn die Buchungsangebote deaktiviert sind, bricht der Endpoint nicht
    // mehr hart ab. Stattdessen erhält das Frontend ein minimales Payload
    // (`offersEnabled: false`) und schaltet auf den Personal-Modus um.
    if (!publicOffersEnabled) {
      const branding = await CatalogService.getBranding();
      return response.status(200).send({
        offersEnabled: false,
        slug,
        branding,
      });
    }

    const catalog = await CatalogService.getCatalog(slug);

    // Whatever fails on the token path is the client's 401, the contract of
    // the auth middleware; only a typed error keeps its own status.
    let user;
    try {
      user = await authenticateIfNeeded(
        request,
        catalog.visibility === "private",
      );
    } catch (error) {
      if (error instanceof BaseError) {
        throw error;
      }
      throw new UnauthorizedError("invalid_token");
    }
    if (user) request.user = user;

    await assertCatalogSlugAccess(catalog, request.user?.id);

    response.status(200).send(catalog);
  }

  /**
   * The Theme Bundle, revalidated by the client rather than purged by the
   * backend (storefront ADR 0001): it carries the strong `ETag` of the
   * export and `Cache-Control: no-cache`, so the storefront may keep the
   * body but has to ask before using it, and a request whose
   * `If-None-Match` names the current tag is answered 304 without one.
   * The visibility of a slug catalog is decided per request, ahead of the
   * cache, so a tag never stands in for a permission.
   */
  static async getTheme(request, response) {
    const slug = request.params.slug;

    if (slug) {
      const catalog = await CatalogService.getCatalog(slug);
      await assertCatalogSlugAccess(catalog, request.user?.id);
    }

    const { body, etag } = await CatalogService.getThemeExport(slug);

    response.set("ETag", etag);
    response.set("Cache-Control", "no-cache");

    if (matchesEntityTag(request.get("If-None-Match"), etag)) {
      return response.status(304).end();
    }

    response.status(200).send(body);
  }

  static async storeInstanceCatalog(request, response) {
    const catalogData = request.body;

    if (catalogData._id) {
      const updatedCatalog =
        await CatalogService.updateInstanceCatalog(catalogData);
      ApiResponse.ok(response, { content: updatedCatalog });
    } else {
      const createdCatalog =
        await CatalogService.createInstanceCatalog(catalogData);
      ApiResponse.created(response, { content: createdCatalog });
    }
  }

  /**
   * `PUT /:tenant/catalog` carries the tenant catalog (`tenant.catalog`: the
   * tenant owner) and, for a catalog that is not a single tenant's, the
   * instance catalog - the second decision of the adapter
   * (`instanceCatalog.store`: the instance owner, spec §5). A body naming
   * another tenant than the route is refused: the route's tenant is the one
   * the marker was decided in.
   */
  static async storeCatalog(request, response) {
    const catalogData = request.body;
    const tenantId = request.params.tenant;

    if (!catalogData) {
      throw new BadRequestError("catalog_required");
    }

    if (catalogData.type === "single") {
      if (tenantId !== catalogData.tenantId) {
        throw new ForbiddenError();
      }

      if (catalogData._id) {
        const updatedCatalog = await CatalogService.updateTenantCatalog(
          tenantId,
          catalogData,
        );
        return ApiResponse.ok(response, { content: updatedCatalog });
      }

      const createdCatalog = await CatalogService.createTenantCatalog(
        tenantId,
        catalogData,
      );
      return ApiResponse.created(response, { content: createdCatalog });
    }

    if (scopeFor(request, "instanceCatalog", "store").reach !== "any") {
      throw new ForbiddenError();
    }

    const updatedCatalog = await CatalogService.updateCatalog(catalogData);
    ApiResponse.ok(response, { content: updatedCatalog });
  }

  static async slugAvailability(request, response) {
    const slug = request.params.slug;

    if (!slug) {
      throw new BadRequestError("slug_required");
    }

    const available = await CatalogService.slugAvailable(slug);

    ApiResponse.ok(response, { available });
  }
}

module.exports = CatalogController;
