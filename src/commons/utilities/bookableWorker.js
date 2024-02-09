// bookableWorker.js
const { parentPort } = require('worker_threads');
const BookableManager = require("../data-managers/bookable-manager");
const BookingManager = require("../data-managers/booking-manager");
var dbm = require("../utilities/database-manager");

async function initDbConnection() {
    await dbm.connect(); // Angenommen, dies ist die Methode zum Herstellen der Verbindung
}

async function fetchOccupancies(bookable, tenant) {
    return initDbConnection().then(async () => {
        let bookings = [];

        // Logik zum Abrufen der Buchungen, wie im ursprünglichen Code
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

        // Filter und Map-Logik, wie im ursprünglichen Code
        const occupancies = bookings
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
        return occupancies;
    });

}

parentPort.on('message', async ({ bookable, tenant }) => {
    const occupancies = await fetchOccupancies(bookable, tenant);
    parentPort.postMessage(occupancies);
});
