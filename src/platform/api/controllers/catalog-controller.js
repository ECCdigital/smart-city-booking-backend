const CatalogService = require("../../../commons/services/catalog-service");
const PermissionService = require("../../../commons/services/permission-service");
const bunyan = require("bunyan");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const {
  authenticateIfNeeded,
} = require("../../../commons/utilities/auth-utils");

const logger = bunyan.createLogger({
  name: "catalog-controller.js",
  level: process.env.LOG_LEVEL,
});

class CatalogController {
  static async getCatalogByTenant(request, response) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;

      const tenant = await TenantManager.getTenant(tenantId);

      if (
        user &&
        ((await PermissionService._isTenantOwner(user.id, tenant.id)) ||
          (await PermissionService._isInstanceOwner(user.id)))
      ) {
        logger.info(
          `Sending catalog for tenant ${tenantId} to user ${user?.id} with details`,
        );

        const catalog = await CatalogService.getCatalogByTenant(tenantId);

        response.status(200).send(catalog);
      } else {
        response.sendStatus(403);
      }
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

      const catalog = await CatalogService.getCatalog(slug);

      try {
        const user = authenticateIfNeeded(request, catalog.visibility === "private");
        if (user) request.user = user;

        //TODO: Add permission checks here if needed
      } catch (error) {
        console.error("Authentication error:", error);

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

      const { theme, visibility } = await CatalogService.getTheme(slug);

      try {
        const user = authenticateIfNeeded(request, visibility === "private");
        if (user) request.user = user;

        //TODO: Add permission checks here if needed
      } catch (error) {
        console.error("Authentication error:", error);

        return response.status(401).json({ message: error.message });
      }

      response.status(200).send(theme);
    } catch (error) {
      console.error("Error in CatalogController.getTheme:", error);
      response.status(500).send({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  }

  static async storeCatalog(request, response) {
    try {
      const catalogData = request.body;
      const user = request.user;
      const tenantId = request.params.tenant;

      console.log("Catalog data received:", catalogData);

      if (!catalogData) {
        return response.status(400).send({
          success: false,
          message: "Catalog data is required.",
        });
      }

      if (catalogData.type === "single") {
        const tenant = await TenantManager.getTenant(tenantId);

        if (
          tenantId === catalogData.tenantId &&
          user &&
          ((await PermissionService._isTenantOwner(user.id, tenant.id)) ||
            (await PermissionService._isInstanceOwner(user.id)))
        ) {
          if (catalogData._id) {
            const updatedCatalog = await CatalogService.updateTenantCatalog(
              tenantId,
              catalogData,
            );
            response.status(200).send({
              success: true,
              content: updatedCatalog,
            });
          } else {
            const createdCatalog = await CatalogService.createTenantCatalog(
              tenantId,
              catalogData,
            );
            response.status(201).send({
              success: true,
              content: createdCatalog,
            });
          }
        } else {
          return response.status(403).send({
            success: false,
            message: "You do not have permission to store this catalog.",
          });
        }
      } else {
        if (user && (await PermissionService._isInstanceOwner(user.id))) {
          const updatedCatalog =
            await CatalogService.updateCatalog(catalogData);
          response.status(200).send({
            success: true,
            content: updatedCatalog,
          });
        } else {
          return response.status(403).send({
            success: false,
            message: "You do not have permission to store this catalog.",
          });
        }
      }
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
