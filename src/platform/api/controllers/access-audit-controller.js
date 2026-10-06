const bunyan = require("bunyan");
const AccessAuditService = require("../../../commons/services/access/access-audit-service");

const logger = bunyan.createLogger({
  name: "access-audit-controller.js",
  level: process.env.LOG_LEVEL,
});

class AccessAuditController {
  /**
   * GET /:tenant/access/audit/export
   *
   * Query params:
   *   - format: "csv" (default) | "pdf"
   *   - from, to: ISO date or epoch ms (inclusive bounds)
   *   - bookingId, accessPointId, provider, action, result: optional filters
   *
   * Returns a tenant-wide access audit log export for compliance. Audit data
   * covers all bookings of a tenant, so the route asks for the tenant-wide
   * booking read right (`accessAudit.export`).
   */
  static async exportAudit(request, response) {
    try {
      const { tenant } = request.params;
      const user = request.user;

      const format = String(request.query.format || "csv").toLowerCase();
      const filters = {
        from: request.query.from,
        to: request.query.to,
        bookingId: request.query.bookingId,
        accessPointId: request.query.accessPointId,
        provider: request.query.provider,
        action: request.query.action,
        result: request.query.result,
      };

      const entries = await AccessAuditService.getAuditEntries(tenant, filters);

      logger.info(
        `${tenant} -- user ${user.id} exported access audit log (${format}, ${entries.length} entries)`,
      );

      if (format === "pdf") {
        const { buffer, name } = await AccessAuditService.toPdf(
          tenant,
          entries,
          filters,
        );
        response.setHeader("Content-Type", "application/pdf");
        response.setHeader(
          "Content-Disposition",
          `attachment; filename=${name}`,
        );
        return response.status(200).send(buffer);
      }

      if (format !== "csv") {
        return response
          .status(400)
          .send("Unsupported export format. Use 'csv' or 'pdf'.");
      }

      const csv = AccessAuditService.toCsv(entries);
      const filename = `access-audit-${tenant}-${Date.now()}.csv`;
      response.setHeader("Content-Type", "text/csv");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename=${filename}`,
      );
      return response.status(200).send(csv);
    } catch (err) {
      logger.error(err);
      return response.status(500).send("Could not export access audit log");
    }
  }
}

module.exports = AccessAuditController;
