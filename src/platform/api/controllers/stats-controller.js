const bunyan = require("bunyan");
const StatsService = require("../../../commons/services/stats-service");
const CompanyController = require("./company-controller");

const logger = bunyan.createLogger({
  name: "stats-controller.js",
  level: process.env.LOG_LEVEL,
});

class StatsController {
  static async getStats(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const companyId = request.query.companyId
        ? String(request.query.companyId)
        : undefined;
      const stats = await StatsService.getStats(tenantId, companyId);
      return response.status(200).send(stats);
    } catch (error) {
      logger.error("Could not load admin stats", error);
      return response
        .status(error.status || 500)
        .send(error.message || "Could not load admin stats");
    }
  }
}

module.exports = StatsController;
