const {
  applyTimeToDate,
  findFirstWeekdayOnOrAfter,
} = require("./block-period-generator");

/**
 * @param {Object} timePeriod
 * @param {Date} anchorDate Date on the slot's weekday (midnight).
 * @returns {{ timeBegin: number, timeEnd: number }|null}
 */
function buildTimePeriodInstance(timePeriod, anchorDate) {
  const timeBegin = applyTimeToDate(anchorDate, timePeriod.startTime);
  const timeEnd = applyTimeToDate(anchorDate, timePeriod.endTime);

  if (timeEnd.getTime() <= timeBegin.getTime()) {
    return null;
  }

  return {
    timeBegin: timeBegin.getTime(),
    timeEnd: timeEnd.getTime(),
  };
}

/**
 * @param {Object} timePeriod
 * @param {Date|number} rangeStart
 * @param {Date|number} rangeEnd
 * @returns {Array<{ timeBegin: number, timeEnd: number }>}
 */
function generateTimePeriodInstancesForDefinition(
  timePeriod,
  rangeStart,
  rangeEnd,
) {
  const rangeStartMs = new Date(rangeStart).getTime();
  const rangeEndMs = new Date(rangeEnd).getTime();

  if (
    !Number.isFinite(rangeStartMs) ||
    !Number.isFinite(rangeEndMs) ||
    rangeEndMs <= rangeStartMs ||
    !Array.isArray(timePeriod.weekdays) ||
    timePeriod.weekdays.length === 0
  ) {
    return [];
  }

  const instances = [];

  for (const weekday of timePeriod.weekdays) {
    let anchor = findFirstWeekdayOnOrAfter(new Date(rangeStart), weekday);
    anchor.setDate(anchor.getDate() - 7);

    while (true) {
      const instance = buildTimePeriodInstance(timePeriod, anchor);

      if (!instance || instance.timeBegin >= rangeEndMs) {
        break;
      }

      if (instance.timeEnd > rangeStartMs) {
        instances.push(instance);
      }

      anchor.setDate(anchor.getDate() + 7);
    }
  }

  return instances;
}

/**
 * @param {Date|number} rangeStart
 * @param {Date|number} rangeEnd
 * @param {Object[]} timePeriods
 * @returns {Array<{ timeBegin: number, timeEnd: number }>}
 */
function generateTimePeriodInstances(rangeStart, rangeEnd, timePeriods) {
  if (!Array.isArray(timePeriods) || timePeriods.length === 0) {
    return [];
  }

  const instances = timePeriods.flatMap((timePeriod) =>
    generateTimePeriodInstancesForDefinition(timePeriod, rangeStart, rangeEnd),
  );

  instances.sort((a, b) => a.timeBegin - b.timeBegin || a.timeEnd - b.timeEnd);

  const seen = new Set();
  return instances.filter((instance) => {
    const key = `${instance.timeBegin}:${instance.timeEnd}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * @param {Object|null|undefined} bookable
 * @returns {boolean}
 */
function isTimePeriodBookable(bookable) {
  return bookable?.isTimePeriodRelated === true;
}

/**
 * Returns true when the given window exactly matches a generated time-period slot.
 *
 * @param {number} timeBegin
 * @param {number} timeEnd
 * @param {Object[]} timePeriods
 * @returns {boolean}
 */
function matchesTimePeriodInstance(timeBegin, timeEnd, timePeriods) {
  const beginMs = Number(timeBegin);
  const endMs = Number(timeEnd);

  if (
    !Number.isFinite(beginMs) ||
    !Number.isFinite(endMs) ||
    endMs <= beginMs
  ) {
    return false;
  }

  const searchStart = beginMs - 24 * 60 * 60 * 1000;
  const searchEnd = endMs + 24 * 60 * 60 * 1000;
  const instances = generateTimePeriodInstances(
    searchStart,
    searchEnd,
    timePeriods,
  );

  return instances.some(
    (instance) => instance.timeBegin === beginMs && instance.timeEnd === endMs,
  );
}

module.exports = {
  buildTimePeriodInstance,
  generateTimePeriodInstancesForDefinition,
  generateTimePeriodInstances,
  isTimePeriodBookable,
  matchesTimePeriodInstance,
};
