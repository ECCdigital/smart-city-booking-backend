const bunyan = require("bunyan");
const AccessPointManager = require("../../data-managers/access-point-manager");
const AccessLogService = require("./access-log-service");
const {
  projectAccessPoint,
  projectCompartment,
} = require("./access-point-projection");
const { compartmentsOf } = require("./locker-system-compartments");
const { compartmentPointId } = require("./compartment-allocation");

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
    const hits = await this._findScanCode(tenantId, scanCode);

    if (hits.length !== 1) {
      if (hits.length > 1) {
        logger.warn(
          `${tenantId} -- scan code presented by user ${userId} is carried more than once, treated as unknown`,
        );
      }
      return this._fail(SCAN_FAILURE_REASONS.UNKNOWN_SCAN_CODE, {
        tenantId,
        scanCode,
        userId,
        accessPoint: null,
      });
    }

    const [{ accessPoint, compartment }] = hits;

    if (compartment) {
      return this._resolveCompartment(tenantId, scanCode, userId, {
        lockerSystem: accessPoint,
        compartment,
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
   * Everything of the tenant that carries the code, current or replaced: a
   * door or Anlage by its own code, and every Fach of an Anlage with its own
   * list. More than one hit makes the code ambiguous - a sticker that could
   * mean two places leads nowhere.
   *
   * @returns {Promise<Array<{ accessPoint: Object, compartment: Object|null }>>}
   *   `compartment` is the Fach's entry for a hit at a Fach, `null` otherwise
   */
  static async _findScanCode(tenantId, scanCode) {
    const [accessPoint, lockerSystems] = await Promise.all([
      AccessPointManager.getAccessPointByScanCode(tenantId, scanCode),
      AccessPointManager.getLockerSystemsByCompartmentScanCode(
        tenantId,
        scanCode,
      ),
    ]);

    const hits = accessPoint ? [{ accessPoint, compartment: null }] : [];
    for (const lockerSystem of lockerSystems) {
      for (const compartment of compartmentsOf(lockerSystem)) {
        if (carriesScanCode(compartment, scanCode)) {
          hits.push({ accessPoint: lockerSystem, compartment });
        }
      }
    }
    return hits;
  }

  /**
   * @private
   * Resolve a code found at a Fach of a Schließfachanlage: a replaced code is
   * stale like at a door, the current one answers with the Fach - out of
   * service or not, the page in front of it decides nothing by that.
   *
   * @param {string} tenantId
   * @param {string} scanCode
   * @param {string|null} userId
   * @param {{ lockerSystem: Object, compartment: Object }} hit The Anlage and
   *   the Fach's entry in its list
   */
  static async _resolveCompartment(
    tenantId,
    scanCode,
    userId,
    { lockerSystem, compartment },
  ) {
    if (compartment.scanCode !== scanCode) {
      return this._fail(SCAN_FAILURE_REASONS.STALE_SCAN_CODE, {
        tenantId,
        scanCode,
        userId,
        accessPoint: this._compartmentPoint(lockerSystem, compartment),
      });
    }

    return {
      success: true,
      data: projectCompartment(lockerSystem, compartment),
    };
  }

  /**
   * @private
   * A Fach as the access log names it, like opening it does: the Anlage's
   * type and provider under `<anlage>:<Fach UUID>`, the UUID as its external
   * id.
   */
  static _compartmentPoint(lockerSystem, compartment) {
    return {
      id: compartmentPointId(lockerSystem.id, compartment.id),
      type: lockerSystem.type,
      provider: lockerSystem.provider,
      externalId: String(compartment.id),
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

/**
 * Whether a Fach carries the code, as its current or a replaced one.
 *
 * @param {Object} compartment The Fach's entry in `config.compartments`
 * @param {string} scanCode
 * @returns {boolean}
 */
function carriesScanCode(compartment, scanCode) {
  return (
    compartment.scanCode === scanCode ||
    (Array.isArray(compartment.previousScanCodes) &&
      compartment.previousScanCodes.includes(scanCode))
  );
}

module.exports = AccessScanService;
module.exports.SCAN_FAILURE_REASONS = SCAN_FAILURE_REASONS;
