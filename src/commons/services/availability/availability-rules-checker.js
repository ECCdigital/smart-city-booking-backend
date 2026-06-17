const {
  CheckoutPermissions,
} = require("../checkout/item-checkout-service");
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
 * @param {import("./availability-context").AvailabilityContext} context
 * @returns {boolean}
 */
function isEventDateBookable(context) {
  const bookable = context.bookable;

  if (bookable?.type !== BOOKABLE_TYPES.TICKET || !bookable.eventId) {
    return true;
  }

  if (!context.event) {
    return false;
  }

  const eventDate = getEventReferenceDate(context.event);
  if (!eventDate) {
    return true;
  }

  return eventDate >= new Date();
}

/**
 * @param {import("./availability-context").AvailabilityContext} context
 * @param {string|undefined} userId
 * @returns {Promise<boolean>}
 */
async function hasBookingPermission(context, userId) {
  const bookable = context.bookable;

  if (!bookable || bookable.isBookable !== true) {
    return false;
  }

  return CheckoutPermissions._allowCheckout(bookable, userId, context.tenantId);
}

/**
 * @param {import("./availability-context").AvailabilityContext} context
 * @param {number} amount
 * @returns {boolean}
 */
function hasEventSeatsAvailable(context, amount) {
  const bookable = context.bookable;

  if (bookable?.type !== BOOKABLE_TYPES.TICKET || !bookable.eventId) {
    return true;
  }

  const event = context.event;
  const maxAttendees = event?.attendees?.maxAttendees;

  if (!maxAttendees) {
    return true;
  }

  const eventBookings = context.eventBookings || [];
  const amountBooked = eventBookings
    .map((booking) => booking.bookableItems)
    .flat()
    .filter(
      (item) =>
        item._bookableUsed?.eventId === bookable.eventId &&
        item._bookableUsed?.tenantId === bookable.tenantId,
    )
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

  return Number(amountBooked) + Number(amount) <= Number(maxAttendees);
}

module.exports = {
  hasBookingPermission,
  hasEventSeatsAvailable,
  isEventDateBookable,
  getEventReferenceDate,
};
