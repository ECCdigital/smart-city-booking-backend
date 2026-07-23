const {
  getBookingDurationHours: getDurationHours,
  isDurationAllowed,
} = require("../../availability/availability-rules/duration-rules");

/**
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @param {number} timeBegin
 * @param {number} timeEnd
 * @returns {number}
 */
function getBookingDurationHours(bookable, timeBegin, timeEnd) {
  return getDurationHours(timeBegin, timeEnd);
}

/**
 * Marks available segments as unavailable when they are shorter than minBookingDuration.
 *
 * @param {Array<{ timeBegin: number, timeEnd: number, available: boolean }>} segments
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @returns {Array<{ timeBegin: number, timeEnd: number, available: boolean }>}
 */
function applyMinBookingDurationFilter(segments, bookable) {
  if (!bookable?.isScheduleRelated || !bookable.minBookingDuration) {
    return segments;
  }

  const minDurationMs = Number(bookable.minBookingDuration) * 60 * 60 * 1000;

  return segments.map((segment) => {
    if (!segment.available) {
      return segment;
    }

    const durationMs = segment.timeEnd - segment.timeBegin;
    if (durationMs < minDurationMs) {
      return {
        ...segment,
        available: false,
      };
    }

    return segment;
  });
}

/**
 * Marks available segments as unavailable when their duration exceeds maxBookingDuration.
 *
 * @param {Array<{ timeBegin: number, timeEnd: number, available: boolean }>} segments
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @returns {Array<{ timeBegin: number, timeEnd: number, available: boolean }>}
 */
function applyMaxBookingDurationFilter(segments, bookable) {
  if (!bookable?.isScheduleRelated || !bookable.maxBookingDuration) {
    return segments;
  }

  const maxDurationMs = Number(bookable.maxBookingDuration) * 60 * 60 * 1000;

  return segments.map((segment) => {
    if (!segment.available) {
      return segment;
    }

    const durationMs = segment.timeEnd - segment.timeBegin;
    if (durationMs > maxDurationMs) {
      return {
        ...segment,
        available: false,
      };
    }

    return segment;
  });
}

/**
 * @param {Array<{ timeBegin: number, timeEnd: number, available: boolean }>} segments
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @returns {Array<{ timeBegin: number, timeEnd: number, available: boolean }>}
 */
function applyBookingDurationRules(segments, bookable) {
  return applyMinBookingDurationFilter(segments, bookable);
}

/**
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @param {number} timeBegin
 * @param {number} timeEnd
 * @returns {boolean}
 */
function isBookingDurationAllowed(bookable, timeBegin, timeEnd) {
  return isDurationAllowed(bookable, timeBegin, timeEnd);
}

module.exports = {
  applyBookingDurationRules,
  applyMinBookingDurationFilter,
  applyMaxBookingDurationFilter,
  isBookingDurationAllowed,
  getBookingDurationHours,
};
