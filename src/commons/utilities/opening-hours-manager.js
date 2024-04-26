const { Bookable } = require("../entities/bookable");
const { get } = require("./database-manager");
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
   * Find out all opening hours for a bookable object and check if opening hours are in conflict with booking hours.
   *
   * @param bookable Array of bookable objects
   * @param timeBegin Start time of the booking
   * @param timeEnd End time of the booking
   * @returns {Promise<boolean>}
   */
  static async hasOpeningHoursConflict(bookable, timeBegin, timeEnd) {
    if (bookable.isOpeningHoursRelated) {
      const openingHours = bookable.openingHours;
      const bookingStartDay = new Date(timeBegin).getDay();
      const bookingEndDay = new Date(timeEnd).getDay();
      const days = [];
      if (bookingStartDay !== bookingEndDay) {
        // get multiple days
        for (let i = bookingStartDay; i <= bookingEndDay; i++) {
          days.push(i);
        }
      } else {
        days.push(bookingStartDay);
      }

      // check if booking is in opening hours
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
          const ohStart = new Date(timeBegin);
          const ohEnd = new Date(timeEnd);
          ohStart.setHours(
            oh.startTime.split(":")[0],
            oh.startTime.split(":")[1],
          );
          ohEnd.setHours(oh.endTime.split(":")[0], oh.endTime.split(":")[1]);

          if (bookingStart < ohStart || bookingEnd > ohEnd) {
            return true;
          }
        }
      }
    }
    if (bookable.isSpecialOpeningHoursRelated) {
      const dates = [];
      const bookingStartDate = new Date(timeBegin).getTime();
      const bookingEndDate = new Date(timeEnd).getTime();
      const bookingStartISO = new Date(bookingStartDate)
        .toISOString()
        .split("T")[0];
      const bookingEndISO = new Date(bookingEndDate)
        .toISOString()
        .split("T")[0];

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

      // check if booking is in special opening hours
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
              !(
                dates[0] >= sohStartDate &&
                dates[dates.length - 1] <= sohEndDate
              )
            ) {
              return true;
            } else if (sohStartDate === sohEndDate) {
              // if start and end date are the same, the whole day is closed
              return true;
            }
          }
        }
      }
      return false;
    }
    return false;
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
      return Object.assign(new Bookable(), b);
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
          const { weekdays, ...newCur } = cur;
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

module.exports = OpeningHoursManager;
