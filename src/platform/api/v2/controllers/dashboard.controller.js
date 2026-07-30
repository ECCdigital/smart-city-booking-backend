const bunyan = require("bunyan");
const DashboardService = require("../../../../commons/services/dashboard/dashboard-service");
const ApiResponse = require("../../../../commons/utilities/api-response");
const { BaseError } = require("../../../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "dashboard.controller.v2.js",
  level: process.env.LOG_LEVEL,
});

class DashboardControllerV2 {
  static async getInstanceSummary(req, res) {
    try {
      const data = await DashboardService.getInstanceSummary(
        req.user.id,
        req.query,
      );
      return ApiResponse.ok(res, { data });
    } catch (err) {
      return DashboardControllerV2._handleError(err, res, "getInstanceSummary");
    }
  }

  static async getTenantSummary(req, res) {
    try {
      const data = await DashboardService.getTenantSummary(
        req.user.id,
        req.params.tenant,
        req.query,
      );
      return ApiResponse.ok(res, { data });
    } catch (err) {
      return DashboardControllerV2._handleError(err, res, "getTenantSummary");
    }
  }

  static _handleError(err, res, action) {
    if (err instanceof BaseError) {
      const status = err.statusCode || 500;
      if (status === 400) {
        return ApiResponse.badRequest(res, err.code || err.message);
      }
      if (status === 403) {
        return ApiResponse.forbidden(res, err.code || err.message);
      }
      if (status === 404) {
        return ApiResponse.notFound(res, err.code || err.message);
      }
      return ApiResponse.error(res, err.code || err.message);
    }

    logger.error({ err }, `${action}: unexpected error`);
    return ApiResponse.error(res, "Internal server error");
  }
}

module.exports = DashboardControllerV2;
