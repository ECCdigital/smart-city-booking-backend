const bunyan = require("bunyan");
const AccessPointManager = require("../../data-managers/access-point-manager");
const AccessLogService = require("./access-log-service");
const { projectAccessPoint } = require("./access-point-projection");

const logger = bunyan.createLogger({
  name: "access-scan-service.js",
  level: process.env.LOG_LEVEL,
});

const SCAN_FAILURE_REASONS = Object.freeze({
  STALE_SCAN_CODE: "stale_scan_code",
  UNKNOWN_SCAN_CODE: "unknown_scan_code",
});

/**
 * Turns the code on a printed sticker into the access point it identifies.
 * Resolution is always scoped to one tenant.
 */
class AccessScanService {
  /**
   * Resolve a scanned code to its access point.
   *
   * A code the tenant does not carry is a soft failure rather than an error:
   * the request was answered, the sticker just did not lead anywhere. The two
   * failures are told apart because they mean different things to the person
   * at the door - a stale code is a sticker that should be replaced, an
   * unknown one was never issued here.
   *
   * A resolved code answers with the same projection the booking way uses, so
   * the person at the door reads one access point, not two shapes of it. It
   * knows no booking, so it carries the core fields only.
   *
   * Without a booking there is no access role, so nothing is waived: the
   * answer names the rules of the door as they are configured, for everyone.
   * Whoever just scanned holds the evidence anyway - naming the demand costs
   * them nothing, and hiding it would strand them in front of a locked door.
   *
   * @param {string} tenantId The tenant the code was scanned for
   * @param {string} scanCode The scanned code
   * @param {string|null} [userId=null] The user holding the scanner
   * @returns {Promise<{ success: true, data: Object }
   *   | { success: false, data: { reason: string, accessPointId: string|null } }>}
   *   The access point as the API hands it out, or why the code did not resolve
   */
  static async resolveScanCode(tenantId, scanCode, userId = null) {
    const accessPoint = await AccessPointManager.getAccessPointByScanCode(
      tenantId,
      scanCode,
    );

    if (!accessPoint) {
      return this._fail(SCAN_FAILURE_REASONS.UNKNOWN_SCAN_CODE, {
        tenantId,
        scanCode,
        userId,
        accessPoint: null,
      });
    }

    if (accessPoint.scanCode !== scanCode) {
      return this._fail(SCAN_FAILURE_REASONS.STALE_SCAN_CODE, {
        tenantId,
        scanCode,
        userId,
        accessPoint,
      });
    }

    return {
      success: true,
      data: projectAccessPoint(accessPoint),
    };
  }

  /**
   * @private
   * Audit a code that did not resolve and turn it into a soft failure. Only
   * failures are recorded: a code that leads to its door is a lookup, not an
   * event worth keeping for two years.
   *
   * The presented code goes into `payload.presentedScanCode` because the audit
   * export redacts payload keys named `code`, and an investigation needs to
   * see which sticker was held up.
   */
  static async _fail(reason, { tenantId, scanCode, userId, accessPoint }) {
    logger.info(
      `${tenantId} -- scan code presented by user ${userId} did not resolve: ${reason}`,
    );

    try {
      await AccessLogService.log({
        tenantId,
        accessPointId: accessPoint?.id || null,
        accessPointType: accessPoint?.type || null,
        provider: accessPoint?.provider || null,
        externalId: accessPoint?.externalId || null,
        action: "scan",
        actor: { userId: userId || null, source: userId ? "user" : "system" },
        result: "denied",
        payload: { presentedScanCode: scanCode },
        errorCode: reason,
      });
    } catch (err) {
      logger.error(`Failed to write access log: ${err.message}`);
    }

    return {
      success: false,
      data: { reason, accessPointId: accessPoint?.id || null },
    };
  }
}

module.exports = AccessScanService;
module.exports.SCAN_FAILURE_REASONS = SCAN_FAILURE_REASONS;
