const AccessPointManager = require("../../data-managers/access-point-manager");
const LockerSystemMutex = require("./locker-system-mutex");
const LockerSystemRedistribution = require("./locker-system-redistribution");
const {
  carriesOwnCompartments,
  compartmentsOf,
  withScanCodes,
} = require("./locker-system-compartments");

/**
 * The scan codes of the Fächer of a Schließfachanlage that carries its own
 * list (tickets#1055): every save and every rotation of such an Anlage runs
 * under its mutex and reads the stored Anlage again there, so a save never
 * writes back a code rotated while it was under way, and a rotation never
 * writes back what a save changed. The Anlage's own code is never printed
 * and never rotated.
 */
class CompartmentScanCodeService {
  /**
   * Store a new access point; an Anlage with its own list gets a fresh code
   * on each of its Fächer.
   *
   * @param {AccessPoint} accessPoint The access point to create, written into
   * @param {string} tenantId Tenant the access point belongs to
   * @returns {Promise<AccessPoint>} The stored access point
   */
  static async storeCreated(accessPoint, tenantId) {
    return AccessPointManager.storeAccessPoint(
      withCompartmentScanCodes(accessPoint, null),
      tenantId,
    );
  }

  /**
   * Store an update of an access point, moving the future bookings off a
   * Fach that leaves the Zuteilung (`storeRedistributing`). An Anlage with
   * its own list is stored under its mutex, its Fächer keeping the codes
   * they carry at this moment, read again under the mutex; a Fach new to it
   * gets a fresh code. Every other access point is stored straight away.
   * The mutex is re-entrant, so a store that moves bookings holds it once.
   *
   * @param {string} tenantId Tenant the access point belongs to
   * @param {Object} before The access point as the save read it first
   * @param {AccessPoint} accessPoint The access point as it will be stored,
   *   written into
   * @param {{ userId?: string }} [options]
   * @returns {Promise<{ accessPoint: AccessPoint, unmoved: Object[] }>} The
   *   stored access point and the bookings no Fach was free for
   */
  static async storeUpdated(tenantId, before, accessPoint, { userId } = {}) {
    const store = () =>
      LockerSystemRedistribution.storeRedistributing(
        tenantId,
        before,
        accessPoint,
        async () =>
          AccessPointManager.storeAccessPoint(
            withCompartmentScanCodes(
              accessPoint,
              await storedUnderHold(accessPoint, before, tenantId),
            ),
            tenantId,
          ),
        { userId },
      );

    return carriesOwnCompartments(accessPoint)
      ? LockerSystemMutex.hold(accessPoint, store)
      : store();
  }

  /**
   * Rotate the scan code of one Fach of an Anlage with its own list
   * (tickets#1061), by the door's rule.
   *
   * @param {string} tenantId Tenant the Anlage belongs to
   * @param {string} id The Anlage's id
   * @param {string} compartmentId The UUID of the Fach
   * @returns {Promise<AccessPoint|null>} The stored Anlage; `null` for an
   *   access point that is no Anlage with its own list or carries no such
   *   Fach
   */
  static async rotateCompartmentScanCode(tenantId, id, compartmentId) {
    return this._rotateUnderHold(tenantId, id, (lockerSystem) =>
      lockerSystem.rotateCompartmentScanCode(compartmentId),
    );
  }

  /**
   * Rotate the scan codes of all Fächer of an Anlage with its own list
   * (tickets#1063), each by the rule of one Fach, the Anlage stored once.
   *
   * @param {string} tenantId Tenant the Anlage belongs to
   * @param {string} id The Anlage's id
   * @returns {Promise<AccessPoint|null>} The stored Anlage; `null` for an
   *   access point that is no Anlage with its own list
   */
  static async rotateAllCompartmentScanCodes(tenantId, id) {
    return this._rotateUnderHold(tenantId, id, (lockerSystem) =>
      lockerSystem.rotateAllCompartmentScanCodes(),
    );
  }

  /**
   * @private
   * Read the Anlage, hold its mutex, read it again inside, `rotate` it and
   * store it once. No mutex is taken for an access point that is no Anlage
   * with its own list.
   *
   * @param {(lockerSystem: AccessPoint) => boolean} rotate Rotates codes of
   *   the Anlage read under the mutex; answers whether it did
   * @returns {Promise<AccessPoint|null>} The stored Anlage, or `null`
   */
  static async _rotateUnderHold(tenantId, id, rotate) {
    const lockerSystem = await AccessPointManager.getAccessPoint(id, tenantId);
    if (!carriesOwnCompartments(lockerSystem)) {
      return null;
    }

    return LockerSystemMutex.hold(lockerSystem, async () => {
      const current = await AccessPointManager.getAccessPoint(id, tenantId);
      if (!carriesOwnCompartments(current) || !rotate(current)) {
        return null;
      }
      return AccessPointManager.storeAccessPoint(current, tenantId);
    });
  }
}

/**
 * The access point as stored right now, read again under the mutex of an
 * Anlage with its own list, so its Fächer keep the codes they carry at this
 * moment. Every other access point, and one gone in between, answers what
 * the save read first.
 */
async function storedUnderHold(accessPoint, before, tenantId) {
  if (!carriesOwnCompartments(accessPoint)) {
    return before;
  }
  return (
    (await AccessPointManager.getAccessPoint(accessPoint.id, tenantId)) ??
    before
  );
}

/**
 * The Anlage with a scan code on each of its Fächer, see `withScanCodes`:
 * kept from the stored Anlage, fresh for a Fach new to it. Every other
 * access point is left as it is.
 *
 * @param {AccessPoint} accessPoint Written into
 * @param {Object|null} stored As stored before the save, `null` on a create
 * @returns {AccessPoint} The access point
 */
function withCompartmentScanCodes(accessPoint, stored) {
  if (carriesOwnCompartments(accessPoint)) {
    accessPoint.config = {
      ...accessPoint.config,
      compartments: withScanCodes(
        accessPoint.config.compartments,
        compartmentsOf(stored),
      ),
    };
  }
  return accessPoint;
}

module.exports = CompartmentScanCodeService;
