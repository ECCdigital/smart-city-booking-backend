const { AccessPointType } = require("../../schemas/accessPointSchema");

const IFBS = "ifbs";

/**
 * `bookable.lockerDetails` as the admin UI edited it until the locker
 * fold, derived from the locker rows the bookable references: `active`
 * while the bookable's access points are switched on and a locker system
 * is among them, one unit per row in the shape the row's provider used to
 * be configured in - an iFBS location, a Pareva size - with the bookable's
 * amount as the unit's, since capacity is the bookable's. Nothing writes
 * it; the rows are the truth.
 *
 * @param {Object} bookable The bookable, read for `accessPointDetails` and
 *   `amount`
 * @param {Object[]} accessPoints The rows the bookable's ids resolve to
 * @returns {{ active: boolean, units: Object[] }}
 */
function deriveLockerDetails(bookable, accessPoints) {
  const details = bookable.accessPointDetails || {};
  const referenced = (details.accessPointIds || []).map(String);
  const rows = (accessPoints || []).filter(
    (accessPoint) =>
      accessPoint.type === AccessPointType.LOCKER &&
      referenced.includes(String(accessPoint.id)),
  );
  const amount = Number(bookable.amount);
  const units = rows.map((row) => toUnit(row, amount));

  return {
    active: details.active === true && units.length > 0,
    units,
  };
}

/**
 * A locker row as the unit the bookable used to be configured with: an
 * iFBS location, or a size of any other provider.
 *
 * @param {Object} row The locker row
 * @param {number} amount The unit's amount
 * @returns {Object}
 */
function toUnit(row, amount) {
  return row.provider === IFBS
    ? { lockerSystem: IFBS, locationId: row.externalId, amount }
    : { id: row.externalId, lockerSystem: row.provider, amount };
}

module.exports = { deriveLockerDetails, toUnit };
