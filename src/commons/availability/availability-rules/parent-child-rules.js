const {
  getBookedAmountForBookableSet,
  sumBookedAmountForBookableSet,
} = require("./booking-amount");
const { evaluateOriginCapacity } = require("./capacity-rules");
const { CAPACITY_MODES } = require("./types");
const {
  combineAdjacentIntervals,
} = require("../../services/availability/availability-interval-utils");

/**
 * Parent capacity: exclusive for non-ticket children, additive with child tickets for ticket children.
 *
 * @param {Object} params
 * @param {number} params.parentAmountBooked
 * @param {number} [params.childTicketAmountBooked]
 * @param {number|null|undefined} params.capacity
 * @param {number} params.requestedAmount
 * @param {boolean} params.isTicketChild
 * @returns {boolean}
 */
function evaluateParentCapacity({
  parentAmountBooked,
  childTicketAmountBooked = 0,
  capacity,
  requestedAmount,
  isTicketChild,
}) {
  if (!capacity) {
    return true;
  }

  if (isTicketChild) {
    return (
      parentAmountBooked + childTicketAmountBooked + requestedAmount <= capacity
    );
  }

  return parentAmountBooked < capacity;
}

/**
 * Child capacity: additive — requested amount counts against child capacity.
 *
 * @param {Object} params
 * @param {number} params.childAmountBooked
 * @param {number|null|undefined} params.capacity
 * @param {number} params.requestedAmount
 * @returns {boolean}
 */
function evaluateChildCapacity({
  childAmountBooked,
  capacity,
  requestedAmount,
}) {
  if (!capacity) {
    return true;
  }

  return childAmountBooked + requestedAmount <= capacity;
}

/**
 * Ticket-parent capacity intervals combining parent + related child bookings.
 *
 * @param {Object} params
 * @param {number} params.windowStart
 * @param {number} params.windowEnd
 * @param {import("../../entities/booking/booking").Booking[]} params.bookings
 * @param {import("../../entities/bookable/bookable").Bookable} params.parentBookable
 * @param {import("../../entities/bookable/bookable").Bookable[]} params.relatedBookables
 * @param {number} params.requestedAmount
 * @param {boolean} params.useTimeOverlap
 * @returns {import("./types").AvailabilityInterval[]}
 */
function evaluateTicketParentCapacityIntervals({
  windowStart,
  windowEnd,
  bookings,
  parentBookable,
  relatedBookables,
  requestedAmount,
  useTimeOverlap,
}) {
  const capacity = parentBookable.amount;
  if (!capacity) {
    return [
      {
        timeBegin: windowStart,
        timeEnd: windowEnd,
        available: true,
      },
    ];
  }

  const relevantIds = new Set([
    parentBookable.id,
    ...relatedBookables.map((bookable) => bookable.id),
  ]);

  if (!useTimeOverlap) {
    const amountBooked = sumBookedAmountForBookableSet(bookings, relevantIds);

    return [
      {
        timeBegin: windowStart,
        timeEnd: windowEnd,
        available: amountBooked + requestedAmount <= capacity,
      },
    ];
  }

  const events = [];

  for (const booking of bookings) {
    const amount = getBookedAmountForBookableSet(booking, relevantIds);
    if (amount <= 0) {
      continue;
    }

    let start = booking.timeBegin;
    let end = booking.timeEnd;

    if (start == null || end == null) {
      start = windowStart;
      end = windowEnd;
    } else {
      start = Math.max(start, windowStart);
      end = Math.min(end, windowEnd);
      if (start >= end) {
        continue;
      }
    }

    events.push({ x: start, delta: amount });
    events.push({ x: end, delta: -amount });
  }

  events.push({ x: windowStart, delta: 0 });
  events.push({ x: windowEnd, delta: 0 });
  events.sort((a, b) => a.x - b.x || a.delta - b.delta);

  let booked = 0;
  let prevX = windowStart;
  const intervals = [];

  for (const event of events) {
    if (event.x > prevX) {
      intervals.push({
        timeBegin: prevX,
        timeEnd: event.x,
        available: booked + requestedAmount <= capacity,
      });
    }

    booked += event.delta;
    prevX = event.x;
  }

  return combineAdjacentIntervals(intervals);
}

/**
 * Convenience wrapper for point-in-time parent checks using booking lists.
 *
 * @param {Object} params
 * @param {import("../../entities/booking/booking").Booking[]} params.parentBookings
 * @param {string} params.parentBookableId
 * @param {import("../../entities/booking/booking").Booking[]} [params.childBookings]
 * @param {Set<string>|string[]} [params.childBookableIds]
 * @param {number|null|undefined} params.capacity
 * @param {number} params.requestedAmount
 * @param {boolean} params.isTicketChild
 * @returns {boolean}
 */
function evaluateParentCapacityFromBookings({
  parentBookings,
  parentBookableId,
  childBookings = [],
  childBookableIds = [],
  capacity,
  requestedAmount,
  isTicketChild,
}) {
  const { amountBooked: parentAmountBooked } = evaluateOriginCapacity({
    bookings: parentBookings,
    bookableId: parentBookableId,
    capacity: capacity || 1,
    amount: 0,
    mode: CAPACITY_MODES.ADDITIVE,
  });

  const childTicketAmountBooked = isTicketChild
    ? sumBookedAmountForBookableSet(childBookings, childBookableIds)
    : 0;

  return evaluateParentCapacity({
    parentAmountBooked,
    childTicketAmountBooked,
    capacity,
    requestedAmount,
    isTicketChild,
  });
}

module.exports = {
  evaluateParentCapacity,
  evaluateChildCapacity,
  evaluateTicketParentCapacityIntervals,
  evaluateParentCapacityFromBookings,
};
