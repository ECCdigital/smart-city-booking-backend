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

  const parsedTimeBegin = Number(timeBegin);
  const parsedTimeEnd = Number(timeEnd);

  if (!Number.isFinite(parsedTimeBegin) || !Number.isFinite(parsedTimeEnd)) {
    return false;
  }

  return matchesBlockPeriodInstance(
    parsedTimeBegin,
    parsedTimeEnd,
    bookable.blockPeriods,
  );
}

module.exports = {
  shouldSkipOpeningHoursCheck,
  isBlockPeriodBookingValid,
};
