/**
 * `accessPointDetails.accessPointAmounts` of a bookable: `{ "<accessPointId>":
 * <n> }`, how many compartments a booking gets at each of the bookable's
 * locker systems. The bookable's `amount` is distributed over its systems by
 * the editor, not owed at each of them again - a bookable of 12 at two
 * systems gives a booking 12 compartments, not 24. The platform distributes
 * nothing itself; the numbers are the editor's.
 *
 * One reader for every place that asks, so the service that makes the
 * compartments, the controller that stores the map and the derived
 * `lockerDetails` agree on what an amount is.
 */

/**
 * Whether a value is a number of compartments: a whole, non-negative one.
 * Nothing else counts - an empty field is no number, not zero.
 *
 * @param {*} value The value as it was stored or sent in
 * @returns {boolean}
 */
function isCompartmentAmount(value) {
  if (value === undefined || value === null || value === "") {
    return false;
  }

  const amount = Number(value);
  return Number.isInteger(amount) && amount >= 0;
}

/**
 * How many compartments the bookable distributes to one of its locker
 * systems. A system the map says nothing about - or says something that is
 * no number of compartments - gets the fallback: what the reader owed it
 * before there was a distribution, so a bookable saved without the field
 * behaves as it always did.
 *
 * @param {Object} bookable The bookable, read for `accessPointDetails`
 * @param {string} accessPointId The id of the locker system's row
 * @param {number} fallback What the system is owed without a distribution
 * @returns {number} The compartments owed there
 */
function compartmentsAt(bookable, accessPointId, fallback) {
  const distributed =
    bookable?.accessPointDetails?.accessPointAmounts?.[String(accessPointId)];

  return isCompartmentAmount(distributed) ? Number(distributed) : fallback;
}

module.exports = { isCompartmentAmount, compartmentsAt };
