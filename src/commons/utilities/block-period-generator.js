const {
  getBlockPeriodDayOffset,
  parseTimeToMinutes,
} = require("./block-period-validation");

/**
 * @param {Date} date
 * @returns {Date}
 */
function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * @param {Date} date
 * @param {string} time
 * @returns {Date}
 */
function applyTimeToDate(date, time) {
  const [hours, minutes] = time.split(":").map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * @param {Date} fromDate
 * @param {number} weekday
 * @returns {Date}
 */
function findFirstWeekdayOnOrAfter(fromDate, weekday) {
  const date = startOfDay(fromDate);
  const diff = (weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diff);
  return date;
}

/**
 * @param {Object} blockPeriod
 * @param {Date} anchorDate Date on the block's start weekday (midnight).
 * @returns {{ blockPeriodId: string, label: string, timeBegin: number, timeEnd: number }}
 */
function buildBlockPeriodInstance(blockPeriod, anchorDate) {
  const timeBegin = applyTimeToDate(anchorDate, blockPeriod.startTime);
  const dayOffset = getBlockPeriodDayOffset(
    blockPeriod.startWeekday,
    blockPeriod.startTime,
    blockPeriod.endWeekday,
    blockPeriod.endTime,
  );
  const endDate = new Date(anchorDate);
  endDate.setDate(endDate.getDate() + dayOffset);
  const timeEnd = applyTimeToDate(endDate, blockPeriod.endTime);

  return {
    blockPeriodId: blockPeriod.id,
    label: blockPeriod.label,
    timeBegin: timeBegin.getTime(),
    timeEnd: timeEnd.getTime(),
  };
}

/**
 * @param {Object} blockPeriod
 * @param {Date|number} rangeStart
 * @param {Date|number} rangeEnd
 * @returns {Array<{ blockPeriodId: string, label: string, timeBegin: number, timeEnd: number }>}
 */
function generateBlockPeriodInstancesForDefinition(
  blockPeriod,
  rangeStart,
  rangeEnd,
) {
  const rangeStartMs = new Date(rangeStart).getTime();
  const rangeEndMs = new Date(rangeEnd).getTime();
  const instances = [];

  let anchor = findFirstWeekdayOnOrAfter(
    new Date(rangeStart),
    blockPeriod.startWeekday,
  );
  anchor.setDate(anchor.getDate() - 7);

  while (true) {
    const instance = buildBlockPeriodInstance(blockPeriod, anchor);

    if (instance.timeBegin >= rangeEndMs) {
      break;
    }

    if (instance.timeEnd > rangeStartMs) {
      instances.push(instance);
    }

    anchor.setDate(anchor.getDate() + 7);
  }

  return instances;
}

/**
 * @param {Date|number} rangeStart
 * @param {Date|number} rangeEnd
 * @param {Object[]} blockPeriods
 * @returns {Array<{ blockPeriodId: string, label: string, timeBegin: number, timeEnd: number }>}
 */
function generateBlockPeriodInstances(rangeStart, rangeEnd, blockPeriods) {
  if (!Array.isArray(blockPeriods) || blockPeriods.length === 0) {
    return [];
  }

  const instances = blockPeriods.flatMap((blockPeriod) =>
    generateBlockPeriodInstancesForDefinition(
      blockPeriod,
      rangeStart,
      rangeEnd,
    ),
  );

  instances.sort((a, b) => a.timeBegin - b.timeBegin || a.timeEnd - b.timeEnd);

  const seen = new Set();
  return instances.filter((instance) => {
    const key = `${instance.blockPeriodId}:${instance.timeBegin}:${instance.timeEnd}`;
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
function isBlockPeriodBookable(bookable) {
  return bookable?.isBlockPeriodRelated === true;
}

/**
 * Returns true when the given window exactly matches a generated block instance.
 *
 * @param {number} timeBegin
 * @param {number} timeEnd
 * @param {Object[]} blockPeriods
 * @returns {boolean}
 */
function matchesBlockPeriodInstance(timeBegin, timeEnd, blockPeriods) {
  const searchStart = timeBegin - 8 * 24 * 60 * 60 * 1000;
  const searchEnd = timeEnd + 24 * 60 * 60 * 1000;
  const instances = generateBlockPeriodInstances(
    searchStart,
    searchEnd,
    blockPeriods,
  );

  return instances.some(
    (instance) =>
      instance.timeBegin === Number(timeBegin) &&
      instance.timeEnd === Number(timeEnd),
  );
}

module.exports = {
  startOfDay,
  applyTimeToDate,
  findFirstWeekdayOnOrAfter,
  buildBlockPeriodInstance,
  generateBlockPeriodInstancesForDefinition,
  generateBlockPeriodInstances,
  isBlockPeriodBookable,
  matchesBlockPeriodInstance,
  parseTimeToMinutes,
};
