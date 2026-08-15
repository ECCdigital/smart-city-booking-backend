/**
 * Capacity buffer around schedule-related bookings (back-to-back prevention).
 * Mirrors the IFBS LocationBuffer overlap model: existing bookings block
 * [timeBegin - bufferBefore, timeEnd + bufferAfter].
 */

/**
 * @param {import("../entities/bookable/bookable").Bookable|Object} bookable
 * @returns {{ beforeMs: number, afterMs: number }}
 */
function getBookingBufferMs(bookable) {
  if (!bookable?.isScheduleRelated) {
    return { beforeMs: 0, afterMs: 0 };
  }

  return {
    beforeMs:
      Math.max(0, Number(bookable.bufferTimeBeforeMinutes) || 0) * 60 * 1000,
    afterMs:
      Math.max(0, Number(bookable.bufferTimeAfterMinutes) || 0) * 60 * 1000,
  };
}

/**
 * @param {import("../entities/bookable/bookable").Bookable|Object} bookable
 * @returns {boolean}
 */
function isBookingBufferConfigured(bookable) {
  const { beforeMs, afterMs } = getBookingBufferMs(bookable);
  return beforeMs > 0 || afterMs > 0;
}

/**
 * @param {number|null|undefined} timeBegin
 * @param {number|null|undefined} timeEnd
 * @param {number} beforeMs
 * @param {number} afterMs
 * @returns {{ timeBegin: number|null|undefined, timeEnd: number|null|undefined }}
 */
function expandBlockedInterval(timeBegin, timeEnd, beforeMs, afterMs) {
  if (timeBegin == null || timeEnd == null) {
    return { timeBegin, timeEnd };
  }

  return {
    timeBegin: timeBegin - beforeMs,
    timeEnd: timeEnd + afterMs,
  };
}

/**
 * @param {number} requestBegin
 * @param {number} requestEnd
 * @param {number|null|undefined} bookingBegin
 * @param {number|null|undefined} bookingEnd
 * @param {number} beforeMs
 * @param {number} afterMs
 * @returns {boolean}
 */
function overlapsBufferedInterval(
  requestBegin,
  requestEnd,
  bookingBegin,
  bookingEnd,
  beforeMs,
  afterMs,
) {
  if (bookingBegin == null || bookingEnd == null) {
    return true;
  }

  const blocked = expandBlockedInterval(
    bookingBegin,
    bookingEnd,
    beforeMs,
    afterMs,
  );

  return requestBegin < blocked.timeEnd && requestEnd > blocked.timeBegin;
}

/**
 * Widens a query window so bookings whose buffer extends into the request are included.
 *
 * @param {number} timeBegin
 * @param {number} timeEnd
 * @param {number} beforeMs
 * @param {number} afterMs
 * @returns {{ timeBegin: number, timeEnd: number }}
 */
function widenQueryWindow(timeBegin, timeEnd, beforeMs, afterMs) {
  return {
    timeBegin: timeBegin - afterMs,
    timeEnd: timeEnd + beforeMs,
  };
}

module.exports = {
  getBookingBufferMs,
  isBookingBufferConfigured,
  expandBlockedInterval,
  overlapsBufferedInterval,
  widenQueryWindow,
};
