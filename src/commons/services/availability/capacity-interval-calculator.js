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
    bookable.isLongRange === true
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

const {
  combineAdjacentIntervals,
} = require("./availability-interval-utils");
const { intersectAvailability } = require("./availability-interval-merger");

/**
 * Sweep-line capacity check with amount-weighted booking events.
 *
 * @param {Object} params
 * @param {number} params.windowStart
 * @param {number} params.windowEnd
 * @param {import("../../entities/booking/booking").Booking[]} params.bookings
 * @param {string} params.bookableId
 * @param {number|null|undefined} params.capacity
 * @param {number} params.requestedAmount
 * @param {"additive"|"exclusive"} [params.mode]
 * @param {boolean} [params.useTimeOverlap]
 * @returns {Array<{ timeBegin: number, timeEnd: number, available: boolean }>}
 */
function computeCapacityIntervals({
  windowStart,
  windowEnd,
  bookings,
  bookableId,
  capacity,
  requestedAmount,
  mode = "additive",
  useTimeOverlap = true,
}) {
  if (!capacity) {
    return [
      {
        timeBegin: windowStart,
        timeEnd: windowEnd,
        available: true,
      },
    ];
  }

  if (!useTimeOverlap) {
    const amountBooked = bookings.reduce(
      (sum, booking) => sum + getBookedAmountForBookable(booking, bookableId),
      0,
    );
    const available =
      mode === "exclusive"
        ? amountBooked < capacity
        : amountBooked + requestedAmount <= capacity;

    return [
      {
        timeBegin: windowStart,
        timeEnd: windowEnd,
        available,
      },
    ];
  }

  const events = [];

  for (const booking of bookings) {
    const amount = getBookedAmountForBookable(booking, bookableId);
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
      const available =
        mode === "exclusive"
          ? booked < capacity
          : booked + requestedAmount <= capacity;

      intervals.push({
        timeBegin: prevX,
        timeEnd: event.x,
        available,
      });
    }

    booked += event.delta;
    prevX = event.x;
  }

  return combineAdjacentIntervals(intervals);
}

/**
 * Capacity check for ticket parents using combined parent + child bookings.
 */
function computeTicketParentCapacityIntervals({
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
    const amountBooked = bookings.reduce(
      (sum, booking) => sum + getBookedAmountForBookableSet(booking, relevantIds),
      0,
    );

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
 * @param {import("./availability-context").AvailabilityContext} context
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @param {number} windowStart
 * @param {number} windowEnd
 * @returns {import("../../entities/booking/booking").Booking[]}
 */
function getBookingsForCapacityCheck(context, bookable, windowStart, windowEnd) {
  if (isTimeRelatedBookable(bookable)) {
    return context.getConcurrentBookings(
      bookable.id,
      windowStart,
      windowEnd,
    );
  }

  return context.getRelatedBookings(bookable.id);
}

/**
 * @param {import("./availability-context").AvailabilityContext} context
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @param {number} windowStart
 * @param {number} windowEnd
 * @returns {import("../../entities/booking/booking").Booking[]}
 */
function getUniqueBookings(bookings) {
  const byId = new Map();
  for (const booking of bookings) {
    byId.set(booking.id, booking);
  }
  return [...byId.values()];
}

function getTicketParentBookings(
  context,
  parentBookable,
  windowStart,
  windowEnd,
  useTimeOverlap,
) {
  const bookings = [];

  if (useTimeOverlap) {
    bookings.push(
      ...context.getConcurrentBookings(parentBookable.id, windowStart, windowEnd),
    );
    for (const child of context.relatedBookables) {
      bookings.push(
        ...context.getConcurrentBookings(child.id, windowStart, windowEnd),
      );
    }
  } else {
    bookings.push(...context.getRelatedBookings(parentBookable.id));
    for (const child of context.relatedBookables) {
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
    computeCapacityIntervals({
      windowStart,
      windowEnd,
      bookings: getBookingsForCapacityCheck(
        context,
        originBookable,
        windowStart,
        windowEnd,
      ),
      bookableId: originBookable.id,
      capacity: originBookable.amount,
      requestedAmount: amount,
      mode: "additive",
      useTimeOverlap,
    }),
  );

  for (const parentBookable of context.parentBookables) {
    if (originBookable.type === "ticket") {
      constraintSets.push(
        computeTicketParentCapacityIntervals({
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
          relatedBookables: context.relatedBookables,
          requestedAmount: amount,
          useTimeOverlap,
        }),
      );
    } else {
      constraintSets.push(
        computeCapacityIntervals({
          windowStart,
          windowEnd,
          bookings: getBookingsForCapacityCheck(
            context,
            parentBookable,
            windowStart,
            windowEnd,
          ),
          bookableId: parentBookable.id,
          capacity: parentBookable.amount,
          requestedAmount: 1,
          mode: "exclusive",
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
      computeCapacityIntervals({
        windowStart,
        windowEnd,
        bookings: getBookingsForCapacityCheck(
          context,
          childBookable,
          windowStart,
          windowEnd,
        ),
        bookableId: childBookable.id,
        capacity: childBookable.amount,
        requestedAmount: amount,
        mode: "additive",
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
