/**
 * @param {Array<{ timeBegin: number, timeEnd: number, available: boolean }>} intervals
 * @returns {Array<{ timeBegin: number, timeEnd: number, available: boolean }>}
 */
function combineAdjacentIntervals(intervals) {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = [...intervals].sort((a, b) => a.timeBegin - b.timeBegin);
  const merged = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (
      last.available === current.available &&
      last.timeEnd === current.timeBegin
    ) {
      last.timeEnd = current.timeEnd;
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

module.exports = {
  combineAdjacentIntervals,
};
