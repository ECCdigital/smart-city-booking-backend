const {
  CheckoutPermissions,
} = require("../services/checkout/checkout-permissions");
const { BOOKABLE_TYPES } = require("../entities/bookable/bookable");
const {
  isEventBookable,
  hasEventSeats,
} = require("./availability-rules/event-rules");

/**
 * V2 calendar guards using a loaded {@link AvailabilityContext}.
 *
 * @param {import("../services/availability/availability-context").AvailabilityContext} context
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

  return isEventBookable(context.event);
}

/**
 * @param {import("../services/availability/availability-context").AvailabilityContext} context
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
 * @param {import("../services/availability/availability-context").AvailabilityContext} context
 * @param {number} amount
 * @returns {boolean}
 */
function hasEventSeatsAvailable(context, amount) {
  const bookable = context.bookable;

  if (bookable?.type !== BOOKABLE_TYPES.TICKET || !bookable.eventId) {
    return true;
  }

  const seats = hasEventSeats(
    context.eventBookings || [],
    bookable.eventId,
    bookable.tenantId,
    Number(amount),
    context.event?.attendees?.maxAttendees,
  );

  return seats.available;
}

module.exports = {
  hasBookingPermission,
  hasEventSeatsAvailable,
  isEventDateBookable,
};
