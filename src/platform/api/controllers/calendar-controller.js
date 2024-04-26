const { Worker } = require("worker_threads");
const path = require("path");
const bunyan = require("bunyan");

const BookableManager = require("../../../commons/data-managers/bookable-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
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

  static async getBookableAvailabilty(request, response) {
    const user = request.user;
    const tenant = request.params.tenant;
    const bookableId = request.params.id;

    const amount = request.query.amount || 1;

    const startDate = request.query.startDate
      ? new Date(request.query.startDate)
      : new Date();

    const endDate = request.query.endDate
      ? new Date(request.query.endDate)
      : new Date(startDate.getTime() + 60000 * 60 * 24 * 7);

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const startTime = startDate.getTime();
    const endTime = endDate.getTime();

    const interval = 60000 * 60;
    const items = [];

    let i = startTime;

    while (i + interval < endTime) {
      const intervalBegin = i;
      const intervalEnd = i + interval;

      const ics = new ItemCheckoutService(
        user,
        tenant,
        new Date(intervalBegin),
        new Date(intervalEnd),
        bookableId,
        amount,
        null,
      );

      try {
        await ics.checkAll();
      } catch (e) {
        if (
          items.length > 0 &&
          items[items.length - 1].timeEnd === intervalBegin
        ) {
          items[items.length - 1].timeEnd = intervalEnd;
        } else {
          items.push({
            timeBegin: intervalBegin,
            timeEnd: intervalEnd,
            available: false,
          });
        }
      }

      i = intervalEnd;
    }

    response.status(200).send(items);
  }
}

module.exports = CalendarController;
