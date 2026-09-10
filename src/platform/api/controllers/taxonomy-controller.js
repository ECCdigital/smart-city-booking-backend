const bunyan = require("bunyan");
const TaxonomyService = require("../../../commons/services/taxonomy-service");
const CompanyController = require("./company-controller");
const { sendError } = require("../../../commons/utilities/http-error");

const logger = bunyan.createLogger({
  name: "taxonomy-controller.js",
  level: process.env.LOG_LEVEL,
});

function fail(response, error, fallback) {
  logger.error(fallback, error);
  return sendError(response, error, fallback);
}

class TaxonomyController {
  // Public: active terms only, grouped (or flat with ?type=).
  static async getTaxonomies(request, response) {
    try {
      const tenantId = request.params.tenant;
      const type =
        request.query && request.query.type
          ? String(request.query.type)
          : undefined;
      const result = await TaxonomyService.listTaxonomies(tenantId, { type });
      return response.status(200).send(result);
    } catch (error) {
      return fail(response, error, "Could not list taxonomies");
    }
  }

  // Admin: all terms incl. inactive, grouped, with the `active` flag.
  static async adminList(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const type =
        request.query && request.query.type
          ? String(request.query.type)
          : undefined;
      const result = await TaxonomyService.listAllForAdmin(tenantId, { type });
      return response.status(200).send(result);
    } catch (error) {
      return fail(response, error, "Could not list taxonomies");
    }
  }

  static async create(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const term = await TaxonomyService.createTerm(
        tenantId,
        request.body || {},
      );
      return response.status(201).send(term);
    } catch (error) {
      return fail(response, error, "Could not create taxonomy term");
    }
  }

  static async update(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const term = await TaxonomyService.updateTerm(
        tenantId,
        request.params.id,
        request.body || {},
      );
      return response.status(200).send(term);
    } catch (error) {
      return fail(response, error, "Could not update taxonomy term");
    }
  }

  static async reorder(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const body = request.body || {};
      const result = await TaxonomyService.reorderTerms(tenantId, {
        type: body.type,
        orderedIds: body.orderedIds,
      });
      return response.status(200).send(result);
    } catch (error) {
      return fail(response, error, "Could not reorder taxonomy terms");
    }
  }

  static async remove(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const result = await TaxonomyService.deleteTerm(
        tenantId,
        request.params.id,
      );
      return response.status(200).send(result);
    } catch (error) {
      return fail(response, error, "Could not delete taxonomy term");
    }
  }
}

module.exports = TaxonomyController;
