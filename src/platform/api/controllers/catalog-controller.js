const CatalogService = require("../../../commons/services/catalog-service");
const bunyan = require("bunyan");
const InstanceManager = require("../../../commons/data-managers/instance-manager");
const { scopeFor } = require("../../../commons/services/authorization");
const { ForbiddenError } = require("../../../errors/BaseError");
const {
  authenticateIfNeeded,
} = require("../../../commons/utilities/auth-utils");
const {
  assertCatalogSlugAccess,
} = require("../../../commons/utilities/catalog-participation-utils");

const logger = bunyan.createLogger({
  name: "catalog-controller.js",
  level: process.env.LOG_LEVEL,
});

class CatalogController {
  // The instance catalog: the right is the router's (`instanceCatalog.read`,
  // `instanceCatalog.store`: the instance owner).
  static async getInstanceCatalog(request, response) {
    try {
      const catalog = await CatalogService.getInstanceCatalog();

      response.status(200).send(catalog);
    } catch (error) {
      response.status(error.code || 500).send({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  }

  static async getPublicCatalog(request, response) {
    try {
      const catalog = await CatalogService.getInstanceCatalog();

      response.status(200).send(catalog);
    } catch (error) {
      response.status(error.code || 500).send({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  }

  static async getCatalogBundle(request, response) {
    try {
      const bundle = await CatalogService.getCatalogBundle(
        null,
        request.user?.id,
      );

      if (!bundle) {
        return response.status(404).send({
          success: false,
          message: "Catalog bundle not found.",
        });
      }

      // Wenn Offers deaktiviert sind, gibt das Bundle nur Branding + Modus zurück.
      // Visibility-Prüfung greift nur für den Offers-Modus.
      if (bundle.offersEnabled && bundle.catalog?.visibility === "private") {
        const user = request.user;
        if (!user) {
          return response.status(401).send({
            success: false,
            message: "Authentication required to access this catalog.",
          });
        }
      }

      response.status(200).send(bundle);
    } catch (error) {
      response.status(error.code || 500).send({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  }

  /**
   * Liefert dem Frontend den aktuellen Portal-Modus inkl. Branding. Wird vom
   * Catalog-Frontend bei jedem Page-Load als Routing-Hint gelesen.
   */
  static async getPortalMode(request, response) {
    try {
      const mode = await CatalogService.getPortalMode();
      response.status(200).send(mode);
    } catch (error) {
      console.error("Error in CatalogController.getPortalMode:", error);
      response.status(error.code || 500).send({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  }

  // The tenant catalog: the right is the router's (`tenant.catalog`: the
  // tenant owner).
  static async getCatalogByTenant(request, response) {
    try {
      const tenantId = request.params.tenant;

      logger.info(
        `Sending catalog for tenant ${tenantId} to user ${request.user?.id} with details`,
      );

      const catalog = await CatalogService.getCatalogByTenant(tenantId);

      response.status(200).send(catalog);
    } catch (error) {
      response.status(error.code || 500).send({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  }

  static async getCatalogBySlug(request, response) {
    try {
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

      try {
        const user = await authenticateIfNeeded(
          request,
          catalog.visibility === "private",
        );
        if (user) request.user = user;

        await assertCatalogSlugAccess(catalog, request.user?.id);
      } catch (error) {
        if (error.code) {
          return response.status(error.code).json({
            success: false,
            message: error.message,
          });
        }

        return response.status(401).json({ message: error.message });
      }

      response.status(200).send(catalog);
    } catch (error) {
      console.error("Error in CatalogController.getCatalog:", error);
      response.status(500).send({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  }

  static async getTheme(request, response) {
    try {
      const slug = request.params.slug;

      if (slug) {
        const catalog = await CatalogService.getCatalog(slug);
        try {
          await assertCatalogSlugAccess(catalog, request.user?.id);
        } catch (error) {
          return response.status(error.code || 500).json({
            success: false,
            message: error.message || "Internal Server Error",
          });
        }
      }

      const themeData = slug
        ? await CatalogService.getThemeBySlug(slug)
        : await CatalogService.getTheme();

      response.status(200).send(themeData);
    } catch (error) {
      response.status(error.code || 500).send({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  }

  static async storeInstanceCatalog(request, response) {
    try {
      const catalogData = request.body;

      if (catalogData._id) {
        const updatedCatalog =
          await CatalogService.updateInstanceCatalog(catalogData);
        response.status(200).send({
          success: true,
          content: updatedCatalog,
        });
      } else {
        const createdCatalog =
          await CatalogService.createInstanceCatalog(catalogData);
        response.status(201).send({
          success: true,
          content: createdCatalog,
        });
      }
    } catch (error) {
      console.error("Error in CatalogController.storeInstanceCatalog:", error);
      response.status(500).send({
        success: false,
        message: error.message || "Internal Server Error",
      });
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
  static async storeCatalog(request, response, next) {
    try {
      const catalogData = request.body;
      const tenantId = request.params.tenant;

      if (!catalogData) {
        return response.status(400).send({
          success: false,
          message: "Catalog data is required.",
        });
      }

      if (catalogData.type === "single") {
        if (tenantId !== catalogData.tenantId) {
          return next(new ForbiddenError());
        }

        if (catalogData._id) {
          const updatedCatalog = await CatalogService.updateTenantCatalog(
            tenantId,
            catalogData,
          );
          return response.status(200).send({
            success: true,
            content: updatedCatalog,
          });
        }

        const createdCatalog = await CatalogService.createTenantCatalog(
          tenantId,
          catalogData,
        );
        return response.status(201).send({
          success: true,
          content: createdCatalog,
        });
      }

      if (scopeFor(request, "instanceCatalog", "store").reach !== "any") {
        return next(new ForbiddenError());
      }

      const updatedCatalog = await CatalogService.updateCatalog(catalogData);
      response.status(200).send({
        success: true,
        content: updatedCatalog,
      });
    } catch (error) {
      console.error("Error in CatalogController.storeCatalog:", error);
      response.status(500).send({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  }

  static async slugAvailability(request, response) {
    try {
      const slug = request.params.slug;

      if (!slug) {
        return response.status(400).send({
          success: false,
          message: "Slug is required.",
        });
      }

      const available = await CatalogService.slugAvailable(slug);

      response.status(200).send({
        success: true,
        available: available,
      });
    } catch (error) {
      console.error("Error in CatalogController.checkSlug:", error);
      response.status(500).send({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  }
}

module.exports = CatalogController;
