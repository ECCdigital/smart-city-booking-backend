const AccessPointManager = require("../data-managers/access-point-manager");
const {
  carriesOwnCompartments,
  compartmentsOf,
} = require("../services/access/locker-system-compartments");

/**
 * Kapazität des Buchungsobjekts (tickets#1041): how many units of a
 * bookable the availability lets overlap. It is the bookable's `amount`,
 * limited by every Schließfachanlage with its own list of Fächer among the
 * bookable's access points to the number of its Fächer in Betrieb - the
 * platform assigns one Fach per unit, so no more can overlap. An empty
 * `amount` counts as that number; a Fach außer Betrieb does not count.
 * Without such an Anlage it stays `amount`, iFBS and Pareva included.
 *
 * The Anlagen count only while the bookable's access points are switched
 * on (`accessPointDetails.active`), as only then are Fächer assigned.
 */

/**
 * The capacity from the bookable and the rows its access point ids resolve
 * to.
 *
 * @param {Object} bookable The bookable, read for `amount` and
 *   `accessPointDetails`
 * @param {Object[]} accessPoints The access point rows; rows the bookable
 *   does not reference are ignored
 * @returns {number|null} The number of units that may overlap; `null` for
 *   no limit. `0` means none may: every Fach is außer Betrieb.
 */
function capacityOf(bookable, accessPoints) {
  const amount = Number(bookable?.amount);
  const limit = amount > 0 ? amount : null;
  const inService = lockerSystemsOf(bookable, accessPoints).map(
    (accessPoint) =>
      compartmentsOf(accessPoint).filter(
        (compartment) => compartment.outOfService !== true,
      ).length,
  );

  if (inService.length === 0) {
    return limit;
  }

  return Math.min(limit ?? Infinity, ...inService);
}

/**
 * The capacity of a bookable, loading its access points when it has any
 * switched on.
 *
 * @param {string} tenantId The tenant of the bookable
 * @param {Object} bookable The bookable
 * @returns {Promise<number|null>} See `capacityOf`
 */
async function bookableCapacity(tenantId, bookable) {
  const ids = activeAccessPointIds(bookable);
  const accessPoints = ids.length
    ? await AccessPointManager.getAccessPointsByIds(tenantId, ids)
    : [];

  return capacityOf(bookable, accessPoints);
}

/**
 * Whether a capacity lets nothing be booked, every Fach being außer
 * Betrieb. The capacity rules read a falsy capacity as no limit, so a
 * caller checks this before handing them a `0` from here.
 *
 * @param {number|null} capacity See `capacityOf`
 * @returns {boolean}
 */
function isExhausted(capacity) {
  return capacity === 0;
}

function activeAccessPointIds(bookable) {
  const details = bookable?.accessPointDetails;
  return details?.active === true
    ? (details.accessPointIds || []).map(String)
    : [];
}

function lockerSystemsOf(bookable, accessPoints) {
  const ids = activeAccessPointIds(bookable);
  return (accessPoints || []).filter(
    (accessPoint) =>
      ids.includes(String(accessPoint.id)) &&
      carriesOwnCompartments(accessPoint),
  );
}

module.exports = { bookableCapacity, capacityOf, isExhausted };
