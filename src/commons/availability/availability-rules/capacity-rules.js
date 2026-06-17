const {
  getBookedAmountForBookable,
  sumBookedAmount,
} = require("./booking-amount");
const { CAPACITY_MODES } = require("./types");
const {
  combineAdjacentIntervals,
} = require("../../services/availability/availability-interval-utils");

/**
 * Point-in-time capacity check (no time overlap / non-time-related bookables).
 *
 * @param {Object} params
 * @param {import("../../entities/booking/booking").Booking[]} params.bookings
 * @param {string} params.bookableId
 * @param {number|null|undefined} params.capacity
 * @param {number} params.amount
 * @param {import("./types").CapacityMode} [params.mode]
 * @returns {{ available: boolean, amountBooked: number, remaining: number|null }}
 */
function evaluateOriginCapacity({
  bookings,
  bookableId,
  capacity,
  amount,
  mode = CAPACITY_MODES.ADDITIVE,
}) {
  if (!capacity) {
    return { available: true, amountBooked: 0, remaining: null };
  }

  const amountBooked = sumBookedAmount(bookings, bookableId);
  const available =
    mode === CAPACITY_MODES.EXCLUSIVE
      ? amountBooked < capacity
      : amountBooked + amount <= capacity;

  return {
    available,
    amountBooked,
    remaining: capacity - amountBooked,
  };
}

/**
 * Sweep-line capacity intervals for time-overlapping bookings.
 *
 * @param {Object} params
 * @param {number} params.windowStart
 * @param {number} params.windowEnd
 * @param {import("../../entities/booking/booking").Booking[]} params.bookings
 * @param {string} params.bookableId
 * @param {number|null|undefined} params.capacity
 * @param {number} params.requestedAmount
 * @param {import("./types").CapacityMode} [params.mode]
 * @param {boolean} [params.useTimeOverlap]
 * @returns {import("./types").AvailabilityInterval[]}
 */
function evaluateCapacityIntervals({
  windowStart,
  windowEnd,
  bookings,
  bookableId,
  capacity,
  requestedAmount,
  mode = CAPACITY_MODES.ADDITIVE,
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
    const { available } = evaluateOriginCapacity({
      bookings,
      bookableId,
      capacity,
      amount: requestedAmount,
      mode,
    });

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
    const bookedAmount = getBookedAmountForBookable(booking, bookableId);
    if (bookedAmount <= 0) {
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

    events.push({ x: start, delta: bookedAmount });
    events.push({ x: end, delta: -bookedAmount });
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
        mode === CAPACITY_MODES.EXCLUSIVE
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

module.exports = {
  evaluateOriginCapacity,
  evaluateCapacityIntervals,
};
