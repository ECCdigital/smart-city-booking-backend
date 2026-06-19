const {
  isBlockPeriodBookable,
  matchesBlockPeriodInstance,
} = require("../../utilities/block-period-generator");

/**
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @returns {boolean}
 */
function shouldSkipOpeningHoursCheck(bookable) {
  return (
    bookable?.isLongRange === true || bookable?.isBlockPeriodRelated === true
  );
}

/**
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @param {number} timeBegin
 * @param {number} timeEnd
 * @returns {boolean}
 */
function isBlockPeriodBookingValid(bookable, timeBegin, timeEnd) {
  if (!isBlockPeriodBookable(bookable)) {
    return true;
  }

  if (!timeBegin || !timeEnd) {
    return false;
  }

  return matchesBlockPeriodInstance(
    Number(timeBegin),
    Number(timeEnd),
    bookable.blockPeriods,
  );
}

module.exports = {
  shouldSkipOpeningHoursCheck,
  isBlockPeriodBookingValid,
};
