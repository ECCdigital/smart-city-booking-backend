const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const BOOKING_MODE_FLAGS = [
  "isScheduleRelated",
  "isTimePeriodRelated",
  "isLongRange",
  "isBlockPeriodRelated",
];

/**
 * @param {string} time
 * @returns {number}
 */
function parseTimeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * @param {number} startWeekday
 * @param {string} startTime
 * @param {number} endWeekday
 * @param {string} endTime
 * @returns {number} Day offset from start weekday to end weekday.
 */
function getBlockPeriodDayOffset(startWeekday, startTime, endWeekday, endTime) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);

  if (endWeekday > startWeekday) {
    return endWeekday - startWeekday;
  }

  if (endWeekday < startWeekday) {
    return 7 - startWeekday + endWeekday;
  }

  if (endMinutes > startMinutes) {
    return 0;
  }

  return 7;
}

/**
 * @param {number} startWeekday
 * @param {string} startTime
 * @param {number} endWeekday
 * @param {string} endTime
 * @returns {number} Total duration in minutes.
 */
function getBlockPeriodDurationMinutes(
  startWeekday,
  startTime,
  endWeekday,
  endTime,
) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  const dayOffset = getBlockPeriodDayOffset(
    startWeekday,
    startTime,
    endWeekday,
    endTime,
  );

  return dayOffset * 24 * 60 + (endMinutes - startMinutes);
}

/**
 * @param {unknown} weekday
 * @param {string} fieldName
 */
function assertValidWeekday(weekday, fieldName) {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new Error(
      `${fieldName} must be an integer between 0 (Sunday) and 6 (Saturday)`,
    );
  }
}

/**
 * @param {unknown} time
 * @param {string} fieldName
 */
function assertValidTime(time, fieldName) {
  if (typeof time !== "string" || !TIME_PATTERN.test(time)) {
    throw new Error(`${fieldName} must be a time string in HH:mm format`);
  }
}

/**
 * @param {Object} period
 * @param {number} [index]
 */
function validateBlockPeriod(period, index = 0) {
  const prefix = index > 0 ? `blockPeriods[${index}]` : "blockPeriods entry";

  if (!period || typeof period !== "object") {
    throw new Error(`${prefix} must be an object`);
  }

  if (typeof period.id !== "string" || period.id.trim() === "") {
    throw new Error(`${prefix}.id must be a non-empty string`);
  }

  if (typeof period.label !== "string" || period.label.trim() === "") {
    throw new Error(`${prefix}.label must be a non-empty string`);
  }

  assertValidWeekday(period.startWeekday, `${prefix}.startWeekday`);
  assertValidWeekday(period.endWeekday, `${prefix}.endWeekday`);
  assertValidTime(period.startTime, `${prefix}.startTime`);
  assertValidTime(period.endTime, `${prefix}.endTime`);

  if (
    period.startWeekday === period.endWeekday &&
    period.startTime === period.endTime
  ) {
    throw new Error(`${prefix} must have a duration greater than zero`);
  }

  const durationMinutes = getBlockPeriodDurationMinutes(
    period.startWeekday,
    period.startTime,
    period.endWeekday,
    period.endTime,
  );

  if (durationMinutes <= 0) {
    throw new Error(`${prefix} must have a duration greater than zero`);
  }
}

/**
 * @param {Object} bookable
 */
function validateBlockPeriods(bookable) {
  const { isBlockPeriodRelated, blockPeriods } = bookable;

  if (!isBlockPeriodRelated) {
    return;
  }

  if (!Array.isArray(blockPeriods) || blockPeriods.length === 0) {
    throw new Error(
      "blockPeriods must contain at least one entry when isBlockPeriodRelated is true",
    );
  }

  const seenIds = new Set();

  blockPeriods.forEach((period, index) => {
    validateBlockPeriod(period, index);

    if (seenIds.has(period.id)) {
      throw new Error(`blockPeriods contains duplicate id "${period.id}"`);
    }

    seenIds.add(period.id);
  });
}

/**
 * @param {Object} bookable
 */
function validateBookingModeExclusivity(bookable) {
  const activeModes = BOOKING_MODE_FLAGS.filter(
    (flag) => bookable[flag] === true,
  );

  if (activeModes.length > 1) {
    throw new Error(
      `Only one booking mode flag may be true at a time (${activeModes.join(", ")})`,
    );
  }
}

module.exports = {
  TIME_PATTERN,
  BOOKING_MODE_FLAGS,
  parseTimeToMinutes,
  getBlockPeriodDayOffset,
  getBlockPeriodDurationMinutes,
  validateBlockPeriod,
  validateBlockPeriods,
  validateBookingModeExclusivity,
};
