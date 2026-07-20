const bunyan = require("bunyan");
const AuditLogService = require("../../../commons/services/audit-log-service");
const CompanyController = require("./company-controller");

const logger = bunyan.createLogger({
  name: "audit-log-controller.js",
  level: process.env.LOG_LEVEL,
});

const MAX_LIMIT = 200;

class AuditLogController {
  static async list(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const query = request.query || {};
      const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, parseInt(query.limit, 10) || 100),
      );
      const offset = Math.max(0, parseInt(query.offset, 10) || 0);
      const entries = await AuditLogService.list(tenantId, {
        q: query.q ? String(query.q) : undefined,
        action: query.action ? String(query.action) : undefined,
        limit,
        offset,
      });
      return response.status(200).send(entries);
    } catch (error) {
      logger.error("Could not load audit log", error);
      return response
        .status(error.status || 500)
        .send(error.message || "Could not load audit log");
    }
  }
}

module.exports = AuditLogController;
