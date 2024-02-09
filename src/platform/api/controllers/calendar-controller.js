const { Worker } = require('worker_threads');
const path = require('path');
const bunyan = require("bunyan");

const BookableManager = require("../../../commons/data-managers/bookable-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");

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
 * The results from all worker threads are combined into a single array of occupancies, which is then sent as the response.
 */
class CalendarController {
  static async getOccupancies(request, response) {
    const tenant = request.params.tenant;
    let occupancies = [];

    const bookables = await BookableManager.getBookables(tenant);
    /**
     * Initializes a worker thread for each bookable to asynchronously fetch occupancies, returning promises for their resolutions or rejections.
     */
    const workers = bookables.map((bookable) => {
      return new Promise((resolve, reject) => {

        const worker = new Worker(path.resolve(__dirname,"../../../commons/utilities/calendar-occupancy-worker.js"));
        worker.postMessage({ bookable, tenant });

        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
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
}

module.exports = CalendarController;