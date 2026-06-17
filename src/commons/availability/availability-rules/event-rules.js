const { BOOKABLE_TYPES } = require("../../entities/bookable/bookable");

/**
 * @param {import("../../entities/event/event").Event} event
 * @returns {Date|null}
 */
function getEventReferenceDate(event) {
  const eventEndDate = event.information.endDate
    ? new Date(event.information.endDate)
    : null;

  const eventDate =
    eventEndDate ||
    (event.information.startDate
      ? new Date(event.information.startDate)
      : null);

  if (!eventDate) {
    return null;
  }

  if (eventEndDate && event.information.endTime) {
    const [hours, minutes] = event.information.endTime.split(":").map(Number);
    eventEndDate.setHours(hours, minutes, 0, 0);
    return eventEndDate;
  }

  if (!eventEndDate && event.information.startTime) {
    const [hours, minutes] = event.information.startTime.split(":").map(Number);
    eventDate.setHours(hours, minutes, 0, 0);
  }

  return eventDate;
}

/**
 * @param {import("../../entities/event/event").Event|null|undefined} event
 * @param {Date} [now]
 * @returns {boolean}
 */
function isEventBookable(event, now = new Date()) {
  if (!event) {
    return false;
  }

  const eventDate = getEventReferenceDate(event);
  if (!eventDate) {
    return true;
  }

  return eventDate >= now;
}

/**
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @param {import("../../entities/event/event").Event|null|undefined} event
 * @param {Date} [now]
 * @returns {boolean}
 */
function isTicketEventDateBookable(bookable, event, now = new Date()) {
  if (bookable?.type !== BOOKABLE_TYPES.TICKET || !bookable.eventId) {
    return true;
  }

  return isEventBookable(event, now);
}

/**
 * @param {import("../../entities/booking/booking").Booking[]} eventBookings
 * @param {string} eventId
 * @param {string} tenantId
 * @param {number} requestedAmount
 * @param {number|null|undefined} maxAttendees
 * @returns {{ available: boolean, amountBooked: number, remaining: number|null }}
 */
function hasEventSeats(
  eventBookings,
  eventId,
  tenantId,
  requestedAmount,
  maxAttendees,
) {
  if (!maxAttendees) {
    return { available: true, amountBooked: 0, remaining: null };
  }

  const amountBooked = eventBookings
    .map((booking) => booking.bookableItems)
    .flat()
    .filter(
      (item) =>
        item._bookableUsed?.eventId === eventId &&
        item._bookableUsed?.tenantId === tenantId,
    )
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

  const available = Number(amountBooked) + Number(requestedAmount) <= Number(maxAttendees);

  return {
    available,
    amountBooked,
    remaining: maxAttendees - amountBooked,
  };
}

module.exports = {
  getEventReferenceDate,
  isEventBookable,
  isTicketEventDateBookable,
  hasEventSeats,
};
