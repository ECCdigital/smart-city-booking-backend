const { Bookable } = require("../entities/bookable/bookable");
const { isRangeOverlap } = require("range-overlap");
const {
  getBookable,
  getParentBookables,
} = require("../data-managers/bookable-manager");

/**
 *  Opening Hours Manager
 *  @module commons/utilities/opening-hours-manager
 */
class OpeningHoursManager {
  /**
   * Checks if there is a conflict between the booking time and the opening hours or special opening hours of the bookable object.
   *
   * @param {Object} bookable - The bookable object containing opening hours and special opening hours.
   * @param {Number} timeBegin - The start time of the booking in ISO format.
   * @param {Number} timeEnd - The end time of the booking in ISO format.
   * @returns {Promise<boolean>} - Returns a promise that resolves to true if there is a conflict, otherwise false.
   */
  static async hasOpeningHoursConflict(bookable, timeBegin, timeEnd) {
    const openingHoursRelated = bookable.isOpeningHoursRelated;
    const specialOpeningHoursRelated = bookable.isSpecialOpeningHoursRelated;
    if (!openingHoursRelated && !specialOpeningHoursRelated) {
      return false;
    }

    const promises = [];

    if (openingHoursRelated) {
      promises.push(checkOpeningHoursConflict(bookable, timeBegin, timeEnd));
    } else {
      promises.push(Promise.resolve(false));
    }

    if (specialOpeningHoursRelated) {
      promises.push(checkSpecialOpeningHours(bookable, timeBegin, timeEnd));
    } else {
      promises.push(Promise.resolve(false));
    }

    const [openingHoursConflict, specialOpeningHoursConflict] =
      await Promise.all(promises);

    if (specialOpeningHoursRelated && specialOpeningHoursConflict !== null) {
      return specialOpeningHoursConflict;
    } else {
      return openingHoursConflict;
    }
  }
  static async getRelatedOpeningHours(bookableId, tenant) {
    let bookable = await getBookable(bookableId, tenant);
    let relatedBookables = (await getParentBookables(bookableId, tenant)) || [];

    relatedBookables.push(bookable);

    relatedBookables = relatedBookables.filter((b, i) => {
      return relatedBookables.findIndex((b2) => b2.id === b.id) === i;
    });

    const specialOpeningHours = [];

    for (const b of relatedBookables) {
      if (b.isSpecialOpeningHoursRelated) {
        specialOpeningHours.push(...b.specialOpeningHours);
      }
    }

    const filteredSpecialOpeningHours = specialOpeningHours.reduce(
      (acc, cur) => {
        const date = cur.date;
        const existing = acc.find((item) => item.date === date);

        if (!existing) {
          acc.push(cur);
        } else {
          if (
            existing.startTime === existing.endTime ||
            cur.startTime === cur.endTime
          ) {
            if (cur.startTime === cur.endTime) {
              existing.startTime = cur.startTime;
              existing.endTime = cur.endTime;
            }
          } else {
            if (existing.startTime < cur.startTime) {
              existing.startTime = cur.startTime;
            }
            if (existing.endTime > cur.endTime) {
              existing.endTime = cur.endTime;
            }
          }
        }
        return acc;
      },
      [],
    );

    relatedBookables = relatedBookables.map((b) => {
      return new Bookable(b);
    });

    relatedBookables.push(bookable);

    let openingHours = [];
    for (const b of relatedBookables) {
      openingHours = openingHours.concat(b.openingHours || []);
    }

    const combinedOpeningHours = openingHours.reduce((acc, cur) => {
      cur.weekdays?.forEach((weekday) => {
        if (acc[weekday]) {
          const { startTime, endTime } = cur;
          if (acc[weekday].startTime < startTime) {
            acc[weekday].startTime = startTime;
          }
          if (acc[weekday].endTime > endTime) {
            acc[weekday].endTime = endTime;
          }
        } else {
          const { ...newCur } = cur;
          acc[weekday] = { ...newCur };
        }
      });
      return acc;
    }, {});

    return {
      regularOpeningHours: combinedOpeningHours,
      specialOpeningHours: filteredSpecialOpeningHours,
    };
  }
}

/**
 * Checks if the booking time conflicts with the opening hours of the bookable object.
 *
 * @param {Object} bookable - The bookable object containing opening hours.
 * @param {string} timeBegin - The start time of the booking in ISO format.
 * @param {string} timeEnd - The end time of the booking in ISO format.
 * @returns {boolean} - Returns true if there is a conflict, otherwise false.
 */
function checkOpeningHoursConflict(bookable, timeBegin, timeEnd) {
  const openingHours = bookable.openingHours;
  const bookingStartDay = new Date(timeBegin).getDay();
  const bookingEndDay = new Date(timeEnd).getDay();
  const days = [];
  if (bookingStartDay !== bookingEndDay) {
    for (let i = bookingStartDay; i <= bookingEndDay; i++) {
      days.push(i);
    }
  } else {
    days.push(bookingStartDay);
  }

  for (let day of days) {
    const dayOpeningHours = openingHours.filter((oh) =>
      oh.weekdays.includes(day),
    );

    if (dayOpeningHours.length === 0) {
      return true;
    }

    for (let oh of dayOpeningHours) {
      const bookingStart = new Date(timeBegin);
      const bookingEnd = new Date(timeEnd);

      let ohStart;
      let ohEnd;

      if (oh.weekdays.includes(new Date(timeBegin).getDay())) {
        ohStart = new Date(timeBegin);
        ohEnd = new Date(timeBegin);
      } else {
        ohStart = new Date(timeEnd);
        ohEnd = new Date(timeEnd);
      }

      ohStart.setHours(oh.startTime.split(":")[0], oh.startTime.split(":")[1]);
      ohEnd.setHours(oh.endTime.split(":")[0], oh.endTime.split(":")[1]);

      if (
        isRangeOverlap(bookingStart, bookingEnd, ohStart, ohEnd, true) &&
        bookingStart >= ohStart &&
        bookingEnd <= ohEnd
      ) {
        // Booking is within opening hours, so no conflict
        return false;
      }
    }
  }
  return true;
}

function toLocalDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Checks if the booking time conflicts with the special opening hours of the bookable object.
 *
 * @param {Object} bookable - The bookable object containing special opening hours.
 * @param {string} timeBegin - The start time of the booking in ISO format.
 * @param {string} timeEnd - The end time of the booking in ISO format.
 * @returns {boolean|null} - Returns true if there is a conflict, false if there is no conflict, and null if there are no special opening hours for the booking dates.
 */
function checkSpecialOpeningHours(bookable, timeBegin, timeEnd) {
  const bookingStart = new Date(timeBegin);
  const bookingEnd = new Date(timeEnd);

  const days = [];
  const current = new Date(bookingStart);
  current.setHours(0, 0, 0, 0);

  const endDay = new Date(bookingEnd);
  endDay.setHours(0, 0, 0, 0);

  while (current <= endDay) {
    days.push(toLocalDateString(current));
    current.setDate(current.getDate() + 1);
  }

  let hasAnySpecialHours = false;

  for (const day of days) {
    const sohForDay = bookable.specialOpeningHours.filter(
      (soh) => soh.date === day,
    );

    if (sohForDay.length === 0) {
      continue;
    }

    hasAnySpecialHours = true;

    for (const soh of sohForDay) {
      if (soh.startTime === soh.endTime) {
        return true;
      }

      const [sohSH, sohSM] = soh.startTime.split(":").map(Number);
      const [sohEH, sohEM] = soh.endTime.split(":").map(Number);

      const sohStart = new Date(day + "T00:00:00");
      sohStart.setHours(sohSH, sohSM, 0, 0);

      const sohEnd = new Date(day + "T00:00:00");
      sohEnd.setHours(sohEH, sohEM, 0, 0);

      const dayBoundaryStart = new Date(`${day}T00:00:00`);
      const dayBoundaryEnd = new Date(`${day}T23:59:59.999`);

      const dayStart =
        bookingStart > dayBoundaryStart ? bookingStart : dayBoundaryStart;
      const dayEnd =
        bookingEnd < dayBoundaryEnd ? bookingEnd : dayBoundaryEnd;

      if (dayStart < sohStart || dayEnd > sohEnd) {
        return true;
      }
    }
  }

  return hasAnySpecialHours ? false : null;
}

module.exports = OpeningHoursManager;
