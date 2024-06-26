const { parentPort } = require("worker_threads");
const BookableManager = require("../data-managers/bookable-manager");
const BookingManager = require("../data-managers/booking-manager");
const dbm = require("../utilities/database-manager");

async function initDbConnection() {
  await dbm.connect();
}

async function closeDbConnection() {
  await dbm.close();
}

/**
 * Fetches occupancies for a given bookable and tenant.
 *
 * This function first initializes a database connection, then fetches all related bookings for the given bookable and tenant.
 * It also fetches all related bookables for the given bookable and tenant, and their related bookings.
 * The function then filters out bookings without a begin and end time, removes duplicate bookings, and maps the bookings to a new format.
 *
 * @param {Object} bookable - The bookable object.
 * @param {Object} tenant - The tenant object.
 *
 * @returns {Promise<Array>} - A promise that resolves with an array of occupancies for the bookable.
 */
async function fetchOccupancies(bookable, tenant) {
  return initDbConnection().then(async () => {
    let bookings = [];

    bookings = bookings.concat(
      await BookingManager.getRelatedBookings(tenant, bookable.id),
    );

    const relatedBookables = await BookableManager.getRelatedBookables(
      bookable.id,
      tenant,
    );

    for (const relatedBookable of relatedBookables) {
      bookings = bookings.concat(
        await BookingManager.getRelatedBookings(tenant, relatedBookable.id),
      );
    }

    return bookings
      .filter((booking) => !!booking.timeBegin && !!booking.timeEnd)
      .filter(
        (booking, index, self) =>
          self.findIndex((b) => b.id === booking.id) === index,
      )
      .map((booking) => ({
        bookableId: bookable.id,
        title: bookable.title,
        timeBegin: booking.timeBegin,
        timeEnd: booking.timeEnd,
      }));
  });
}

/**
 * Event listener for 'message' event on parentPort.
 *
 * This function is triggered when a 'message' event is emitted on the parentPort. The event data should contain a bookable and a tenant.
 * It fetches occupancies for the given bookable and tenant by calling the fetchOccupancies function.
 * After fetching the occupancies, it closes the database connection and posts the occupancies back to the parent thread using parentPort.postMessage.
 *
 * @listens parentPort:message
 * @param {Object} message - The message object received from the parent thread.
 * @param {Object} message.bookable - The bookable object.
 * @param {Object} message.tenant - The tenant object.
 * @returns {Promise<void>} - A promise that resolves when the occupancies have been posted back to the parent thread.
 */
parentPort.on("message", async ({ bookable, tenant }) => {
  const occupancies = await fetchOccupancies(bookable, tenant);
  await closeDbConnection();
  parentPort.postMessage(occupancies);
  parentPort.close();
});
