const BookableManager = require("../../../commons/data-managers/bookable-manager");
const { Worker } = require('worker_threads');
const path = require('path');

class CalendarController {
  static async getOccupancies(request, response) {
    const startTime = Date.now();
    const tenant = request.params.tenant;
    let occupancies = [];

    const bookables = await BookableManager.getBookables(tenant);
    const workers = bookables.map((bookable) => {
      return new Promise((resolve, reject) => {

        const worker = new Worker(path.resolve(__dirname,"../../../commons/utilities/bookableWorker.js"));
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

    console.log("Time:", Date.now() - startTime, "ms", "Occupancies:", occupancies.length);


    response.status(200).send(occupancies);
  }
}

module.exports = CalendarController;