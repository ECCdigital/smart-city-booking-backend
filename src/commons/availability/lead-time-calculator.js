/**
 * Preparation lead-time calculation for schedule-related bookables.
 *
 * A booking is allowed when, between now and timeBegin, at least one service
 * window contains a contiguous preparation block of preparationLeadTimeMinutes
 * that lies fully within that day's service hours and ends at or before
 * timeBegin.
 */

/**
 * @param {import("../entities/bookable/bookable").Bookable|Object|null|undefined} bookable
 * @returns {boolean}
 */
function isLeadTimeConfigured(bookable) {
  return (
    bookable?.isScheduleRelated === true &&
    Number(bookable.preparationLeadTimeMinutes) > 0 &&
    Array.isArray(bookable.serviceHours) &&
    bookable.serviceHours.length > 0
  );
}

/**
 * @param {string} timeStr
 * @returns {number}
 */
function parseTimeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * @param {Array<{ weekdays: number[], startTime: string, endTime: string }>} serviceHours
 * @param {number} weekday
 * @returns {Array<{ startMinutes: number, endMinutes: number }>}
 */
function getServiceWindowsForWeekday(serviceHours, weekday) {
  const windows = [];

  for (const entry of serviceHours) {
    const weekdays = Array.isArray(entry.weekdays)
      ? entry.weekdays
      : [entry.weekdays];

    if (!weekdays.includes(weekday)) {
      continue;
    }

    windows.push({
      startMinutes: parseTimeToMinutes(entry.startTime),
      endMinutes: parseTimeToMinutes(entry.endTime),
    });
  }

  return windows;
}

/**
 * @param {import("../entities/bookable/bookable").Bookable|Object} bookable
 * @param {number} timeBegin
 * @param {Date} [now]
 * @returns {boolean}
 */
function hasSufficientPreparationLeadTime(bookable, timeBegin, now = new Date()) {
  if (!isLeadTimeConfigured(bookable)) {
    return true;
  }

  const preparationMs =
    Number(bookable.preparationLeadTimeMinutes) * 60 * 1000;
  const nowMs = now.getTime();
  const timeBeginMs = Number(timeBegin);

  if (timeBeginMs <= nowMs) {
    return false;
  }

  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  const bookingDay = new Date(timeBeginMs);
  bookingDay.setHours(0, 0, 0, 0);

  while (cursor.getTime() <= bookingDay.getTime()) {
    const weekday = cursor.getDay();
    const dayStartMs = cursor.getTime();
    const windows = getServiceWindowsForWeekday(bookable.serviceHours, weekday);

    for (const window of windows) {
      const serviceStartMs = dayStartMs + window.startMinutes * 60 * 1000;
      const serviceEndMs = dayStartMs + window.endMinutes * 60 * 1000;
      const minBlockStart = Math.max(nowMs, serviceStartMs);

      const latestBlockEnd = Math.min(timeBeginMs, serviceEndMs);
      const blockStart = latestBlockEnd - preparationMs;

      if (
        blockStart >= minBlockStart &&
        blockStart >= serviceStartMs &&
        latestBlockEnd <= serviceEndMs &&
        latestBlockEnd <= timeBeginMs
      ) {
        return true;
      }

      if (timeBeginMs >= serviceStartMs && timeBeginMs <= serviceEndMs) {
        const blockEndAtBooking = timeBeginMs;
        const blockStartAtBooking = blockEndAtBooking - preparationMs;

        if (
          blockStartAtBooking >= minBlockStart &&
          blockStartAtBooking >= serviceStartMs &&
          blockEndAtBooking <= serviceEndMs
        ) {
          return true;
        }
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return false;
}

/**
 * @param {import("../entities/bookable/bookable").Bookable|Object} bookable
 * @param {Date} [now]
 * @returns {number}
 */
function getEarliestBookableStart(bookable, now = new Date()) {
  if (!isLeadTimeConfigured(bookable)) {
    return now.getTime();
  }

  const preparationMs =
    Number(bookable.preparationLeadTimeMinutes) * 60 * 1000;
  const nowMs = now.getTime();
  const candidates = new Set();

  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  const searchEnd = new Date(now);
  searchEnd.setDate(searchEnd.getDate() + 366);

  while (cursor <= searchEnd) {
    const weekday = cursor.getDay();
    const dayStartMs = cursor.getTime();
    const windows = getServiceWindowsForWeekday(bookable.serviceHours, weekday);

    for (const window of windows) {
      const serviceStartMs = dayStartMs + window.startMinutes * 60 * 1000;
      const serviceEndMs = dayStartMs + window.endMinutes * 60 * 1000;

      candidates.add(serviceStartMs + preparationMs);
      candidates.add(serviceEndMs);
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  const sortedCandidates = [...candidates]
    .filter((candidate) => candidate >= nowMs)
    .sort((a, b) => a - b);

  for (const candidate of sortedCandidates) {
    if (hasSufficientPreparationLeadTime(bookable, candidate, now)) {
      return candidate;
    }
  }

  return searchEnd.getTime();
}

/**
 * Generates calendar periods marking slots before the earliest bookable start
 * as unavailable. Returns an empty array when lead time is not configured.
 *
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {import("../entities/bookable/bookable").Bookable|Object} bookable
 * @param {Date} [now]
 * @returns {Array<{ start: number, end: number, available: boolean }>}
 */
function generateTimePeriodsFromLeadTime(
  startDate,
  endDate,
  bookable,
  now = new Date(),
) {
  if (!isLeadTimeConfigured(bookable)) {
    return [];
  }

  const earliestStart = getEarliestBookableStart(bookable, now);
  const rangeStart = startDate.getTime();
  const rangeEnd = endDate.getTime();

  if (rangeEnd <= earliestStart) {
    return [{ start: rangeStart, end: rangeEnd, available: false }];
  }

  if (rangeStart >= earliestStart) {
    return [{ start: rangeStart, end: rangeEnd, available: true }];
  }

  return [
    { start: rangeStart, end: earliestStart, available: false },
    { start: earliestStart, end: rangeEnd, available: true },
  ];
}

module.exports = {
  isLeadTimeConfigured,
  hasSufficientPreparationLeadTime,
  getEarliestBookableStart,
  generateTimePeriodsFromLeadTime,
  getServiceWindowsForWeekday,
  parseTimeToMinutes,
};
