/**
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @returns {boolean}
 */
function isTimeRelatedBookable(bookable) {
  if (!bookable) {
    return false;
  }

  return (
    bookable.isScheduleRelated === true ||
    bookable.isTimePeriodRelated === true ||
    bookable.isLongRange === true ||
    bookable.isBlockPeriodRelated === true
  );
}

/**
 * @param {import("../../entities/booking/booking").Booking} booking
 * @param {string} bookableId
 * @returns {number}
 */
function getBookedAmountForBookable(booking, bookableId) {
  if (booking.isRejected || !Array.isArray(booking.bookableItems)) {
    return 0;
  }

  return booking.bookableItems
    .filter((item) => item.bookableId === bookableId)
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

/**
 * @param {import("../../entities/booking/booking").Booking} booking
 * @param {Set<string>} bookableIds
 * @returns {number}
 */
function getBookedAmountForBookableSet(booking, bookableIds) {
  if (booking.isRejected || !Array.isArray(booking.bookableItems)) {
    return 0;
  }

  return booking.bookableItems
    .filter((item) => bookableIds.has(item.bookableId))
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

/**
 * @param {import("../../entities/booking/booking").Booking[]} bookings
 * @param {string} bookableId
 * @returns {number}
 */
function sumBookedAmount(bookings, bookableId) {
  return bookings.reduce(
    (sum, booking) => sum + getBookedAmountForBookable(booking, bookableId),
    0,
  );
}

/**
 * @param {import("../../entities/booking/booking").Booking[]} bookings
 * @param {Set<string>|string[]} bookableIds
 * @returns {number}
 */
function sumBookedAmountForBookableSet(bookings, bookableIds) {
  const idSet =
    bookableIds instanceof Set ? bookableIds : new Set(bookableIds);

  return bookings.reduce(
    (sum, booking) => sum + getBookedAmountForBookableSet(booking, idSet),
    0,
  );
}

module.exports = {
  isTimeRelatedBookable,
  getBookedAmountForBookable,
  getBookedAmountForBookableSet,
  sumBookedAmount,
  sumBookedAmountForBookableSet,
};
