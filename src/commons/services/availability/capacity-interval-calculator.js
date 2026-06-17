const {
  isTimeRelatedBookable,
  getBookedAmountForBookable,
} = require("../../availability/availability-rules/booking-amount");
const {
  evaluateCapacityIntervals,
} = require("../../availability/availability-rules/capacity-rules");
const {
  evaluateTicketParentCapacityIntervals,
} = require("../../availability/availability-rules/parent-child-rules");
const { CAPACITY_MODES } = require("../../availability/availability-rules/types");
const { intersectAvailability } = require("./availability-interval-merger");

/** @deprecated Use evaluateCapacityIntervals from availability-rules */
const computeCapacityIntervals = evaluateCapacityIntervals;

/** @deprecated Use evaluateTicketParentCapacityIntervals from availability-rules */
const computeTicketParentCapacityIntervals =
  evaluateTicketParentCapacityIntervals;

/**
 * @param {import("./availability-context").AvailabilityContext} context
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @param {import("../../entities/bookable/bookable").Bookable} originBookable
 * @param {number} windowStart
 * @param {number} windowEnd
 * @returns {import("../../entities/booking/booking").Booking[]}
 */
function getBookingsForCapacityCheck(
  context,
  bookable,
  originBookable,
  windowStart,
  windowEnd,
) {
  if (isTimeRelatedBookable(originBookable)) {
    return context.getConcurrentBookings(bookable.id, windowStart, windowEnd);
  }

  return context.getRelatedBookings(bookable.id);
}

/**
 * @param {import("../../entities/booking/booking").Booking[]} bookings
 * @returns {import("../../entities/booking/booking").Booking[]}
 */
function getUniqueBookings(bookings) {
  const byId = new Map();
  for (const booking of bookings) {
    byId.set(booking.id, booking);
  }
  return [...byId.values()];
}

/**
 * @param {import("./availability-context").AvailabilityContext} context
 * @param {import("../../entities/bookable/bookable").Bookable} parentBookable
 * @param {number} windowStart
 * @param {number} windowEnd
 * @param {boolean} useTimeOverlap
 * @returns {import("../../entities/booking/booking").Booking[]}
 */
function getTicketParentBookings(
  context,
  parentBookable,
  windowStart,
  windowEnd,
  useTimeOverlap,
) {
  const relatedBookables = context.getRelatedBookablesFor(parentBookable.id);
  const bookings = [];

  if (useTimeOverlap) {
    bookings.push(
      ...context.getConcurrentBookings(
        parentBookable.id,
        windowStart,
        windowEnd,
      ),
    );
    for (const child of relatedBookables) {
      bookings.push(
        ...context.getConcurrentBookings(child.id, windowStart, windowEnd),
      );
    }
  } else {
    bookings.push(...context.getRelatedBookings(parentBookable.id));
    for (const child of relatedBookables) {
      bookings.push(...context.getRelatedBookings(child.id));
    }
  }

  return getUniqueBookings(bookings);
}

/**
 * @param {import("./availability-context").AvailabilityContext} context
 * @param {import("../../entities/bookable/bookable").Bookable} originBookable
 * @param {number} windowStart
 * @param {number} windowEnd
 * @param {number} amount
 * @returns {Array<{ timeBegin: number, timeEnd: number, available: boolean }>}
 */
function computeWindowAvailability(
  context,
  originBookable,
  windowStart,
  windowEnd,
  amount,
) {
  const useTimeOverlap = isTimeRelatedBookable(originBookable);
  const constraintSets = [];

  constraintSets.push(
    evaluateCapacityIntervals({
      windowStart,
      windowEnd,
      bookings: getBookingsForCapacityCheck(
        context,
        originBookable,
        originBookable,
        windowStart,
        windowEnd,
      ),
      bookableId: originBookable.id,
      capacity: originBookable.amount,
      requestedAmount: amount,
      mode: CAPACITY_MODES.ADDITIVE,
      useTimeOverlap,
    }),
  );

  for (const parentBookable of context.parentBookables) {
    if (originBookable.type === "ticket") {
      constraintSets.push(
        evaluateTicketParentCapacityIntervals({
          windowStart,
          windowEnd,
          bookings: getTicketParentBookings(
            context,
            parentBookable,
            windowStart,
            windowEnd,
            useTimeOverlap,
          ),
          parentBookable,
          relatedBookables: context.getRelatedBookablesFor(parentBookable.id),
          requestedAmount: amount,
          useTimeOverlap,
        }),
      );
    } else {
      constraintSets.push(
        evaluateCapacityIntervals({
          windowStart,
          windowEnd,
          bookings: getBookingsForCapacityCheck(
            context,
            parentBookable,
            originBookable,
            windowStart,
            windowEnd,
          ),
          bookableId: parentBookable.id,
          capacity: parentBookable.amount,
          requestedAmount: 1,
          mode: CAPACITY_MODES.EXCLUSIVE,
          useTimeOverlap,
        }),
      );
    }
  }

  for (const childBookable of context.relatedBookables) {
    if (childBookable.id === originBookable.id) {
      continue;
    }

    constraintSets.push(
      evaluateCapacityIntervals({
        windowStart,
        windowEnd,
        bookings: getBookingsForCapacityCheck(
          context,
          childBookable,
          originBookable,
          windowStart,
          windowEnd,
        ),
        bookableId: childBookable.id,
        capacity: childBookable.amount,
        requestedAmount: amount,
        mode: CAPACITY_MODES.ADDITIVE,
        useTimeOverlap,
      }),
    );
  }

  return intersectAvailability(constraintSets);
}

module.exports = {
  isTimeRelatedBookable,
  computeCapacityIntervals,
  computeTicketParentCapacityIntervals,
  computeWindowAvailability,
  getBookedAmountForBookable,
};
