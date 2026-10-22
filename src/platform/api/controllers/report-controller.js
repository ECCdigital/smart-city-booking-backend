const bunyan = require("bunyan");
const ReportService = require("../../../commons/services/report/report-service");

const logger = bunyan.createLogger({
  name: "report-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Web Controller of the reports (glossary „Meldung“,
 * ECCdigital/tickets#630). The rights are the router's: reporting is
 * `tenantUser.report` of the tenant, reading and settling `report.read` and
 * `report.resolve` of the instance owner. Whether a target is a tenant
 * owner is the one decision left here, by the marker's second entry
 * (`tenantUser.owner`, as at `remove-user`).
 */
class ReportController {
  /** Reports a member or a booker: 201 for a new report, 200 for an addition. */
  static async createReport(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const { report, created } = await ReportService.report({
        tenantId,
        userId: request.body?.userId,
        bookingId: request.body?.bookingId,
        reason: request.body?.reason,
        by: request.user.id,
        mayReportOwner: request.reaches?.owner === "any",
      });
      logger.info(
        `${tenantId} -- ${created ? "reported" : "added to the report about"} user ${report.targetUserId} by user ${request.user.id}`,
      );
      response.status(created ? 201 : 200).send(report);
    } catch (error) {
      next(error);
    }
  }

  /** The reports for the instance owner, by `?status=` and `?userId=`. */
  static async getReports(request, response, next) {
    try {
      response.status(200).send(
        await ReportService.list({
          status: request.query.status,
          targetUserId: request.query.userId,
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  /** Settles every open report about `userId` with `decision` and `reason`. */
  static async resolveReports(request, response, next) {
    try {
      const settled = await ReportService.resolve({
        userId: request.body?.userId,
        decision: request.body?.decision,
        reason: request.body?.reason,
        by: request.user.id,
      });
      logger.info(
        `Instance -- settled ${settled.length} reports about user ${request.body?.userId} (${request.body?.decision}) by user ${request.user.id}`,
      );
      response.status(200).send(settled);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ReportController;
