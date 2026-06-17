const { combineAdjacentIntervals } = require("./availability-interval-utils");

/**
 * @param {Array<{ timeBegin: number, timeEnd: number, available: boolean }>} segments
 * @param {number} start
 * @param {number} end
 * @returns {boolean|null}
 */
function getIntervalStatus(segments, start, end) {
  const covering = segments.filter(
    (segment) => segment.timeBegin < end && segment.timeEnd > start,
  );

  if (covering.length === 0) {
    return null;
  }

  if (covering.some((segment) => !segment.available)) {
    return false;
  }

  return true;
}

/**
 * Intersect multiple availability segment sets (available only where all agree).
 *
 * @param {Array<Array<{ timeBegin: number, timeEnd: number, available: boolean }>>} segmentSets
 * @returns {Array<{ timeBegin: number, timeEnd: number, available: boolean }>}
 */
function intersectAvailability(segmentSets) {
  const sets = segmentSets.filter((set) => Array.isArray(set) && set.length > 0);
  if (sets.length === 0) {
    return [];
  }

  return sets.reduce((acc, set) => intersectTwoAvailabilitySets(acc, set));
}

/**
 * @param {Array<{ timeBegin: number, timeEnd: number, available: boolean }>} a
 * @param {Array<{ timeBegin: number, timeEnd: number, available: boolean }>} b
 * @returns {Array<{ timeBegin: number, timeEnd: number, available: boolean }>}
 */
function intersectTwoAvailabilitySets(a, b) {
  const boundaries = new Set();

  for (const segment of [...a, ...b]) {
    boundaries.add(segment.timeBegin);
    boundaries.add(segment.timeEnd);
  }

  const sorted = [...boundaries].sort((left, right) => left - right);
  const result = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start >= end) {
      continue;
    }

    const statusA = getIntervalStatus(a, start, end);
    const statusB = getIntervalStatus(b, start, end);

    if (statusA === null && statusB === null) {
      continue;
    }

    if (statusA === null) {
      result.push({ timeBegin: start, timeEnd: end, available: statusB });
      continue;
    }

    if (statusB === null) {
      result.push({ timeBegin: start, timeEnd: end, available: statusA });
      continue;
    }

    result.push({
      timeBegin: start,
      timeEnd: end,
      available: statusA && statusB,
    });
  }

  return combineAdjacentIntervals(result);
}

/**
 * Merge overlapping segments; unavailable always wins.
 *
 * @param {Array<{ timeBegin: number, timeEnd: number, available: boolean }>} segments
 * @returns {Array<{ timeBegin: number, timeEnd: number, available: boolean }>}
 */
function mergeAvailabilitySegments(segments) {
  if (!segments.length) {
    return [];
  }

  const boundaries = new Set();
  for (const segment of segments) {
    boundaries.add(segment.timeBegin);
    boundaries.add(segment.timeEnd);
  }

  const sorted = [...boundaries].sort((left, right) => left - right);
  const result = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start >= end) {
      continue;
    }

    const covering = segments.filter(
      (segment) => segment.timeBegin < end && segment.timeEnd > start,
    );

    if (covering.length === 0) {
      continue;
    }

    const available = !covering.some((segment) => !segment.available);
    result.push({ timeBegin: start, timeEnd: end, available });
  }

  return combineAdjacentIntervals(result);
}

module.exports = {
  intersectAvailability,
  intersectTwoAvailabilitySets,
  mergeAvailabilitySegments,
  getIntervalStatus,
};
