const {
  isTimePeriodBookable,
  matchesTimePeriodInstance,
} = require("../../utilities/time-period-generator");

/**
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @param {number} timeBegin
 * @param {number} timeEnd
 * @returns {boolean}
 */
function isTimePeriodBookingValid(bookable, timeBegin, timeEnd) {
  if (!isTimePeriodBookable(bookable)) {
    return true;
  }

  const parsedTimeBegin = Number(timeBegin);
  const parsedTimeEnd = Number(timeEnd);

  if (!Number.isFinite(parsedTimeBegin) || !Number.isFinite(parsedTimeEnd)) {
    return false;
  }

  if (
    !Array.isArray(bookable.timePeriods) ||
    bookable.timePeriods.length === 0
  ) {
    return false;
  }

  return matchesTimePeriodInstance(
    parsedTimeBegin,
    parsedTimeEnd,
    bookable.timePeriods,
  );
}

module.exports = {
  isTimePeriodBookingValid,
};
