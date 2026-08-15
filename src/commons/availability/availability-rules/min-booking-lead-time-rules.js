const {
  isLeadTimeConfigured,
  hasSufficientPreparationLeadTime,
} = require("../lead-time-calculator");

/**
 * @param {number} timeBegin
 * @param {import("../../entities/bookable/bookable").Bookable|null|undefined} bookable
 * @param {Date} [now]
 * @returns {boolean}
 */
function isWithinMinBookingLeadTime(timeBegin, bookable, now = new Date()) {
  if (!isLeadTimeConfigured(bookable)) {
    return true;
  }

  return hasSufficientPreparationLeadTime(bookable, timeBegin, now);
}

module.exports = {
  isLeadTimeConfigured,
  isWithinMinBookingLeadTime,
};
