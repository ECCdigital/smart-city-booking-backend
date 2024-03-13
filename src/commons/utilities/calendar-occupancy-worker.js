const { parentPort } = require('worker_threads');
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
parentPort.on('message', async ({ bookable, tenant }) => {
    const occupancies = await fetchOccupancies(bookable, tenant);
    await closeDbConnection();
    parentPort.postMessage(occupancies);
});
