const bunyan = require("bunyan");
const AccountDeletionService = require("../../../commons/services/account-deletion-service");
const CompanyController = require("./company-controller");

const logger = bunyan.createLogger({
  name: "account-deletion-controller.js",
  level: process.env.LOG_LEVEL,
});

class AccountDeletionController {
  static async getStats(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const role = request.query.role ? String(request.query.role) : "student";
      const stats = await AccountDeletionService.getStats(tenantId, role);
      return response.status(200).send(stats);
    } catch (error) {
      logger.error("Could not load account deletion stats", error);
      return response
        .status(error.status || 500)
        .send(error.message || "Could not load account deletion stats");
    }
  }
}

module.exports = AccountDeletionController;
