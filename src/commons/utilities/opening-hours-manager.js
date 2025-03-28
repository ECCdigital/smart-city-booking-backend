const { Bookable } = require("../entities/bookable");
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
   * @param {string} timeBegin - The start time of the booking in ISO format.
   * @param {string} timeEnd - The end time of the booking in ISO format.
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

/**
 * Checks if the booking time conflicts with the special opening hours of the bookable object.
 *
 * @param {Object} bookable - The bookable object containing special opening hours.
 * @param {string} timeBegin - The start time of the booking in ISO format.
 * @param {string} timeEnd - The end time of the booking in ISO format.
 * @returns {boolean|null} - Returns true if there is a conflict, false if there is no conflict, and null if there are no special opening hours for the booking dates.
 */
function checkSpecialOpeningHours(bookable, timeBegin, timeEnd) {
  const dates = [];
  const bookingStartDate = new Date(timeBegin).getTime();
  const bookingEndDate = new Date(timeEnd).getTime();
  const bookingStartISO = new Date(bookingStartDate)
    .toISOString()
    .split("T")[0];
  const bookingEndISO = new Date(bookingEndDate).toISOString().split("T")[0];

  dates.push(bookingStartDate);

  let currentDate = new Date(bookingStartISO);
  while (currentDate.toISOString().split("T")[0] <= bookingEndISO) {
    if (currentDate.toISOString().split("T")[0] !== bookingEndISO) {
      currentDate.setDate(currentDate.getDate() + 1);
      let startDate = new Date(currentDate).setHours(0, 0, 0, 0);
      let endDate = new Date(currentDate).setHours(23, 59, 59, 999);
      dates.push(startDate);
      dates.push(endDate);
    } else {
      dates.push(bookingEndDate);
      break;
    }
  }

  for (const date of dates) {
    const sohDates = bookable.specialOpeningHours.filter((soh) => {
      return (
        new Date(soh.date).toISOString().split("T")[0] ===
        new Date(date).toISOString().split("T")[0]
      );
    });
    if (sohDates.length > 0) {
      for (const sohDate of sohDates) {
        const sohStartDate = new Date(
          `${sohDate.date}T${sohDate.startTime}`,
        ).getTime();
        const sohEndDate = new Date(
          `${sohDate.date}T${sohDate.endTime}`,
        ).getTime();

        if (
          !(dates[0] >= sohStartDate && dates[dates.length - 1] <= sohEndDate)
        ) {
          return true;
        } else if (sohStartDate === sohEndDate) {
          return true;
        }
      }
    } else {
      // No special opening hours for the booking dates
      return null;
    }
  }
  return false;
}

module.exports = OpeningHoursManager;
