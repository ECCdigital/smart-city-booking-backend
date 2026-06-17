/**
 * @param {number} timeBegin
 * @param {number} timeEnd
 * @returns {number}
 */
function getBookingDurationHours(timeBegin, timeEnd) {
  return (timeEnd - timeBegin) / (60 * 60 * 1000);
}

/**
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @param {number} timeBegin
 * @param {number} timeEnd
 * @returns {boolean}
 */
function isDurationAllowed(bookable, timeBegin, timeEnd) {
  if (!bookable?.isScheduleRelated) {
    return true;
  }

  const hours = getBookingDurationHours(timeBegin, timeEnd);

  if (
    bookable.minBookingDuration &&
    hours < Number(bookable.minBookingDuration)
  ) {
    return false;
  }

  if (
    bookable.maxBookingDuration &&
    hours > Number(bookable.maxBookingDuration)
  ) {
    return false;
  }

  return true;
}

module.exports = {
  getBookingDurationHours,
  isDurationAllowed,
};
