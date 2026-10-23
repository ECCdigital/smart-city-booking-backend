const bunyan = require("bunyan");
const ReportService = require("../../../commons/services/report/report-service");

const logger = bunyan.createLogger({
  name: "report-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Web Controller of the reports (glossary „Meldung“).
 * The rights are the router's: reporting is
 * `tenantUser.report` of the tenant, reading and settling `report.read` and
 * `report.resolve` of the instance owner. Whether a target is a tenant
 * owner is the one decision left here, by the marker's second entry
 * (`tenantUser.owner`, as at `remove-user`).
 */
class ReportController {
  /**
   * Reports a member or a booker: 201 for a new report, 200 for an
   * addition. `endMembership` ends the member's membership with it.
   */
  static async createReport(request, response, next) {
    if (request.body?.addresses !== undefined) {
      return ReportController.reportAddresses(request, response, next);
    }
    try {
      const tenantId = request.params.tenant;
      const { report, created } = await ReportService.report({
        tenantId,
        userId: request.body?.userId,
        bookingId: request.body?.bookingId,
        reason: request.body?.reason,
        by: request.user.id,
        mayReportOwner: request.reaches?.owner === "any",
        endMembership: request.body?.endMembership === true,
      });
      logger.info(
        `${tenantId} -- ${created ? "reported" : "added to the report about"} user ${report.targetUserId} by user ${request.user.id}`,
      );
      response.status(created ? 201 : 200).send(report);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reports addresses of a booking's `mail`: 201
   * where a report is new, 200 where every one was added to an open one;
   * `blacklisted` names the addresses an entry already hits.
   */
  static async reportAddresses(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const { reports, created, blacklisted } =
        await ReportService.reportAddresses({
          tenantId,
          bookingId: request.body?.bookingId,
          addresses: request.body?.addresses,
          reason: request.body?.reason,
          by: request.user.id,
        });
      logger.info(
        `${tenantId} -- reported ${reports.length} addresses of booking ${request.body?.bookingId} by user ${request.user.id}`,
      );
      response.status(created ? 201 : 200).send({ reports, blacklisted });
    } catch (error) {
      next(error);
    }
  }

  /**
   * The reports for the instance owner, by `?status=`, `?userId=` and
   * `?address=`.
   */
  static async getReports(request, response, next) {
    try {
      response.status(200).send(
        await ReportService.list({
          status: request.query.status,
          targetUserId: request.query.userId,
          targetAddress: request.query.address,
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  /** The reports of the tenant, its own alone. */
  static async getTenantReports(request, response, next) {
    try {
      response.status(200).send(
        await ReportService.list({
          tenantId: request.params.tenant,
          status: request.query.status,
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  /** Adds a reason to an open report of the tenant. */
  static async addReason(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const report = await ReportService.addReason({
        tenantId,
        reportId: request.params.id,
        reason: request.body?.reason,
        by: request.user.id,
        mayReportOwner: request.reaches?.owner === "any",
      });
      logger.info(
        `${tenantId} -- added to report ${report.id} by user ${request.user.id}`,
      );
      response.status(200).send(report);
    } catch (error) {
      next(error);
    }
  }

  /** Withdraws an open report of the tenant. */
  static async withdrawReport(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const report = await ReportService.withdraw({
        tenantId,
        reportId: request.params.id,
        by: request.user.id,
        mayReportOwner: request.reaches?.owner === "any",
      });
      logger.info(
        `${tenantId} -- withdrew report ${report.id} by user ${request.user.id}`,
      );
      response.status(200).send(report);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Settles every open report about `userId`, or about `address` with
   * `domain`, with `decision` and `reason`.
   */
  static async resolveReports(request, response, next) {
    try {
      const settled = await ReportService.resolve({
        userId: request.body?.userId,
        address: request.body?.address,
        domain: request.body?.domain === true,
        decision: request.body?.decision,
        reason: request.body?.reason,
        by: request.user.id,
      });
      logger.info(
        `Instance -- settled ${settled.length} reports about ${request.body?.address ?? `user ${request.body?.userId}`} (${request.body?.decision}) by user ${request.user.id}`,
      );
      response.status(200).send(settled);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ReportController;
