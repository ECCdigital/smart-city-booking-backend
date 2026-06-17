/**
 * @param {number} timeBegin
 * @param {import("../../entities/tenant/tenant").Tenant|null|undefined} tenant
 * @param {Date} [now]
 * @returns {boolean}
 */
function isWithinMaxBookingAdvance(timeBegin, tenant, now = new Date()) {
  const maxBookingAdvanceInMonths = Number(tenant?.maxBookingAdvanceInMonths);
  if (!maxBookingAdvanceInMonths) {
    return true;
  }

  const maxBookingDate = new Date(now);
  maxBookingDate.setMonth(maxBookingDate.getMonth() + maxBookingAdvanceInMonths);

  return timeBegin <= maxBookingDate.getTime();
}

module.exports = {
  isWithinMaxBookingAdvance,
};
