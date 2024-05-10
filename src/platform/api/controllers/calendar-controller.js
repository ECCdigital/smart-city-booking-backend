const { Worker } = require("worker_threads");
const path = require("path");
const bunyan = require("bunyan");

const BookableManager = require("../../../commons/data-managers/bookable-manager");
const ItemCheckoutService = require("../../../commons/services/checkout/item-checkout-service");

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

        // Recursive call for the next item
        return combinePeriods(items, index + 1, combined);
      }

      // Function to check availability for a given time range
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

        try {
          await ics.checkAll();
        } catch (e) {
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
            const bookings = await BookingManager.getConcurrentBookings(bookableId, tenant, start, end);
            if(bookings.length > 0) {
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

      await checkAvailability(startDate.getTime(), endDate.getTime());
      items = combinePeriods(items);

      response.status(200).send(items);
    } catch (error) {
      logger.error(error);
      response.status(500).send({ error: "Internal server error" });
    }
  }
}

module.exports = CalendarController;
