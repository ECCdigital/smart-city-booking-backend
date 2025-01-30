const { Worker } = require("worker_threads");
const path = require("path");
const bunyan = require("bunyan");
const BookableManager = require("../../../commons/data-managers/bookable-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const {
  ItemCheckoutService,
} = require("../../../commons/services/checkout/item-checkout-service");

const logger = bunyan.createLogger({
  name: "calendar-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * CalendarController class.
 *
 * This class is responsible for handling requests related to occupancies in the calendar.
 * It provides a static method `getOccupancies` which fetches occupancies for all bookables for a given tenant.
 * The occupancies are fetched asynchronously using worker threads, one for each bookable.
 * The results from all worker threads are combined into a single array of occupancies, which is then sent as the
 * response.
 */
class CalendarController {
  /**
   * Asynchronously fetches occupancies for all bookables for a given tenant.
   *
   * @async
   * @static
   * @function getOccupancies
   * @param {Object} request - The HTTP request object.
   * @param {Object} response - The HTTP response object.
   * @returns {void}
   *
   * @example
   * // GET /api/<tenant>/calendar/occupancy?ids=1,2,3
   * CalendarController.getOccupancies(req, res);
   */
  static async getOccupancies(request, response) {
    const tenant = request.params.tenant;
    const bookableIds = request.query.ids;
    let occupancies = [];

    let bookables = await BookableManager.getBookables(tenant);

    if (bookableIds && bookableIds.length > 0) {
      bookables = bookables.filter((bookable) =>
        bookableIds.includes(bookable.id),
      );
    }

    /**
     * Initializes a worker thread for each bookable to asynchronously fetch occupancies, returning promises for their
     * resolutions or rejections.
     */
    const workers = bookables.map((bookable) => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(
          path.resolve(
            __dirname,
            "../../../commons/utilities/calendar-occupancy-worker.js",
          ),
        );
        worker.postMessage({ bookable, tenant });

        worker.on("message", resolve);
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
          }
        });
      });
    });

    const results = await Promise.all(workers);
    results.forEach((result) => {
      occupancies = occupancies.concat(result);
    });

    response.status(200).send(occupancies);
  }

  /**
   * Asynchronously fetches the availability of a specific bookable item for a given tenant.
   *
   * @async
   * @function getBookableAvailability
   * @param {Object} request - The HTTP request object. The request should contain the tenant and bookable ID in the params, and optionally the amount, startDate, and endDate in the query.
   * @param {Object} response - The HTTP response object. The response will contain an array of availability periods for the specified bookable item within the specified time range.
   * @returns {void}
   *
   * @example
   * // GET /api/<tenant>/bookables/<bookableId>/availability?amount=1&startDate=2022-01-01&endDate=2022-01-07
   * CalendarController.getBookableAvailability(req, res);
   */
  static async getBookableAvailability(request, response) {
    try {
      const {
        params: { tenant, id: bookableId },
        user,
        query: { amount = 1, startDate: startDateQuery, endDate: endDateQuery },
      } = request;

      if (!tenant || !bookableId) {
        return response
          .status(400)
          .send({ error: "Tenant ID and bookable ID are required." });
      }

      const startDate = startDateQuery ? new Date(startDateQuery) : new Date();
      const endDate = endDateQuery
        ? new Date(endDateQuery)
        : new Date(startDate.getTime() + 60000 * 60 * 24 * 7);

      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      const [parentBookables, bookable, relatedBookables] = await Promise.all([
        BookableManager.getParentBookables(bookableId, tenant),
        BookableManager.getBookable(bookableId, tenant),
        BookableManager.getRelatedBookables(bookableId, tenant),
      ]);

      const bookableToCheck = [
        ...relatedBookables,
        bookable,
        ...parentBookables,
      ];

      let items = [];

      function combinePeriods(items, index = 0, combined = []) {
        // Sort items by timeBegin if it's the first call

        if (index === 0) {
          items.sort((a, b) => a.timeBegin - b.timeBegin);
        }

        // Base case: if index is out of bounds, return the combined periods
        if (index >= items.length) {
          return combined;
        }

        // Combine overlapping periods
        const currentItem = items[index];
        if (index === 0) {
          combined.push(currentItem);
        } else {
          const lastItem = combined[combined.length - 1];
          if (
            lastItem.available === currentItem.available &&
            lastItem.timeEnd >= currentItem.timeBegin
          ) {
            lastItem.timeEnd = Math.max(lastItem.timeEnd, currentItem.timeEnd);
          } else {
            combined.push(currentItem);
          }
        }

        return combinePeriods(items, index + 1, combined);
      }

      /**
       * Asynchronously checks the availability of a bookable item within a given time range.
       *
       * This function is used to determine whether a bookable item is available within a specified time range.
       * It does this by creating an instance of the `ItemCheckoutService` class and calling its `checkAll` method.
       * If the `checkAll` method throws an error, the function assumes that the bookable item is not available.
       *
       * If the time range is greater than 15 minutes, the function splits the time range into two halves
       * and checks the availability for each half separately. This is done by calculating the middle point
       * of the time range and then recursively calling the `checkAvailability` function for the first half
       * (from `start` to `middle`) and the second half (from `middle` to `end`).
       *
       * If the time range is not greater than 15 minutes, the function marks the time range as unavailable.
       * This is done by adding an object to the `items` array, with `timeBegin` and `timeEnd` set to `start`
       * and `end` respectively, and `available` set to `false`.
       *
       * @async
       * @function checkAvailability
       * @param {number} start - The start time of the time range in milliseconds.
       * @param {number} end - The end time of the time range in milliseconds.
       * @returns {Promise<void>} A Promise that resolves when the availability check is complete.
       */
      async function checkAvailability(start, end) {
        const ics = new ItemCheckoutService(
          user,
          tenant,
          new Date(start),
          new Date(end),
          bookableId,
          Number(amount),
          null,
        );

        await ics.init();

        try {
          // in order to check calendar availability, we generally need to perform all checks of the checkout service.
          // EXCEPTION: we do not need to check minimum / maximum durations when checking fixed time periods
          await ics.checkPermissions();
          await ics.checkOpeningHours();
          await ics.checkAvailability();
          await ics.checkEventSeats();
          await ics.checkParentAvailability();
          await ics.checkChildBookings();
          await ics.checkMaxBookingDate();
        } catch {
          /**
           * Checks the availability of a bookable item within a given time range.
           *
           * If the time range is greater than 1 minute, the function splits the time range into two halves
           * and checks the availability for each half separately. This is done by calculating the middle point
           * of the time range and then recursively calling the `checkAvailability` function for the first half
           * (from `start` to `middle`) and the second half (from `middle` to `end`).
           *
           * If the time range is not greater than 1 minute, the function marks the time range as unavailable.
           * This is done by adding an object to the `items` array, with `timeBegin` and `timeEnd` set to `start`
           * and `end` respectively, and `available` set to `false`.
           *
           * @param {number} start - The start time of the time range in milliseconds.
           * @param {number} end - The end time of the time range in milliseconds.
           * @returns {Promise<void>} A Promise that resolves when the availability check is complete.
           */

          if (end - start > 60000 * 15) {
            const middle = Math.round(start + (end - start) / 2);
            await checkAvailability(start, middle);
            await checkAvailability(middle, end);
          } else {
            for (const relatedBookable of bookableToCheck) {
              const bookings = await BookingManager.getConcurrentBookings(
                relatedBookable.id,
                tenant,
                start,
                end,
              );
              if (bookings.length > 0) {
                bookings.forEach((booking) => {
                  items.push({
                    timeBegin: booking.timeBegin,
                    timeEnd: booking.timeEnd,
                    available: false,
                  });
                });
              }
            }
          }
        }
      }

      /**
       * Generates time periods based on the provided start date, end date, and opening hours.
       * The function creates a list of time periods, each indicating whether a bookable item is available or not.
       *
       * @param {Date} startDate - The start date of the period.
       * @param {Date} endDate - The end date of the period.
       * @param {Array} openingHours - An array of objects, each containing the opening hours for a specific day of the week.
       * @returns {Array} An array of time periods, each represented as an object with `start`, `end`, and `available` properties.
       */
      function generateTimePeriods(startDate, endDate, openingHours) {
        if (openingHours.length === 0) {
          return [
            {
              start: startDate.getTime(),
              end: endDate.getTime(),
              available: true,
            },
          ];
        }
        const periods = [];
        let currentDate = new Date(startDate);

        while (currentDate <= endDate) {
          const weekday = ((currentDate.getDay() + 6) % 7) + 1; // monday = 1, ..., sunday = 7

          const hoursForToday = openingHours.find((hours) =>
            hours.weekdays.includes(weekday),
          );

          if (hoursForToday) {
            const start = new Date(currentDate);
            const [startHour, startMinute] = hoursForToday.startTime.split(":");
            start.setHours(startHour, startMinute, 0, 0);

            const end = new Date(currentDate);
            const [endHour, endMinute] = hoursForToday.endTime.split(":");
            end.setHours(endHour, endMinute, 0, 0);

            periods.push({
              start: start.getTime(),
              end: end.getTime(),
              available: true,
            });

            const startOfDay = new Date(currentDate);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(currentDate);
            endOfDay.setHours(23, 59, 59, 999);

            if (start.getTime() > startOfDay.getTime()) {
              periods.push({
                start: startOfDay.getTime(),
                end: start.getTime(),
                available: false,
              });
            }
            if (end.getTime() < endOfDay.getTime()) {
              periods.push({
                start: end.getTime(),
                end: endOfDay.getTime(),
                available: false,
              });
            }
          } else {
            const startOfDay = new Date(currentDate);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(currentDate);
            endOfDay.setHours(23, 59, 59, 999);

            periods.push({
              start: startOfDay.getTime(),
              end: endOfDay.getTime(),
              available: false,
            });
          }

          currentDate.setDate(currentDate.getDate() + 1);
        }

        return periods;
      }

      const openingHours = bookableToCheck
        .map((b) => {
          if (b.isOpeningHoursRelated && b.openingHours.length > 0) {
            return b.openingHours;
          } else {
            return [];
          }
        })
        .flat();

      const availablePeriods = generateTimePeriods(
        startDate,
        endDate,
        openingHours,
      );

      for (const period of availablePeriods) {
        if (period.available) {
          await checkAvailability(period.start, period.end);
        } else {
          items.push({
            timeBegin: period.start,
            timeEnd: period.end,
            available: false,
          });
        }
      }

      items = combinePeriods(items);

      response.status(200).send(items);
    } catch (error) {
      logger.error(error);
      response.status(500).send({ error: "Internal server error" });
    }
  }

  static getTimePeriodsPerHour(startDate, endDate, interval = 60000 * 60) {
    var timePeriodsArray = [];
    var currentDateTime = new Date(startDate);

    while (currentDateTime <= endDate) {
      var nextDateTime = new Date(currentDateTime.getTime() + interval);
      timePeriodsArray.push({
        timeBegin: currentDateTime.getTime(),
        timeEnd: nextDateTime.getTime(),
        available: false,
      });
      currentDateTime = nextDateTime;
    }

    return timePeriodsArray;
  }

  static async getBookableAvailabilityFixed(request, response) {
    const {
      params: { tenant, id: bookableId },
      user,
      query: { amount = 1, startDate: startDateQuery, endDate: endDateQuery },
    } = request;

    if (!tenant || !bookableId) {
      return response
        .status(400)
        .send({ error: "Tenant ID and bookable ID are required." });
    }

    const startDate = startDateQuery ? new Date(startDateQuery) : new Date();
    const endDate = endDateQuery
      ? new Date(endDateQuery)
      : new Date(startDate.getTime() + 60000 * 60 * 24 * 7);

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const periods = CalendarController.getTimePeriodsPerHour(
      startDate,
      endDate,
    );
    for (const p of periods) {
      const itemCheckoutService = new ItemCheckoutService(
        user,
        tenant,
        new Date(p.timeBegin),
        new Date(p.timeEnd),
        bookableId,
        Number(amount),
        null,
      );

      await itemCheckoutService.init()

      try {
        // in order to check calendar availability, we generally need to perform all checks of the checkout service.
        // EXCEPTION: we do not need to check minimum / maximum durations when checking fixed time periods
        await itemCheckoutService.checkPermissions();
        await itemCheckoutService.checkOpeningHours();
        await itemCheckoutService.checkAvailability();
        await itemCheckoutService.checkEventSeats();
        await itemCheckoutService.checkParentAvailability();
        await itemCheckoutService.checkChildBookings();
        await itemCheckoutService.checkMaxBookingDate();
        p.available = true;
      } catch {
        p.available = false;
      }
    }

    periods.sort((a, b) => a.timeBegin - b.timeBegin);

    let combinedPeriods = [];
    let currentPeriod = periods[0];

    for (let i = 1; i < periods.length; i++) {
      if (periods[i].available === currentPeriod.available) {
        currentPeriod.timeEnd = periods[i].timeEnd;
      } else {
        combinedPeriods.push(currentPeriod);
        currentPeriod = periods[i];
      }
    }

    combinedPeriods.push(currentPeriod);

    response.status(200).send(combinedPeriods);
  }
}

module.exports = CalendarController;
