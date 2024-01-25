const BookableManager = require("../../../commons/data-managers/bookable-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const RoleManager = require("../../../commons/data-managers/role-manager");

/**
 * Web Controller for Calendar related data.
 */
class CalendarController {
  static async getOccupancies(request, response) {
    var tenant = request.params.tenant;

    let occupancies = [];

    var bookables = await BookableManager.getBookables(tenant);

    for (const bookable of bookables) {
      let bookings = [];

      // Get the Bookings that are directly related to the bookable object
      bookings = bookings.concat(
        await BookingManager.getRelatedBookings(tenant, bookable.id),
      );

      // Get all Bookings that are related to a child bookable
      const relatedBookables = await BookableManager.getRelatedBookables(
        bookable.id,
        tenant,
      );

      for (const relatedBookable of relatedBookables) {
        bookings = bookings.concat(
          await BookingManager.getRelatedBookings(tenant, relatedBookable.id),
        );
      }

      // Get all Bookings that are related to a parent bookable
      const parentBookables = await BookableManager.getParentBookables(
        bookable.id,
        tenant,
      );

      for (const relatedBookable of relatedBookables) {
        bookings = bookings.concat(
          await BookingManager.getRelatedBookings(tenant, relatedBookable.id),
        );
      }

      // Add the bookings to the occupancies array
      occupancies = occupancies.concat(
        bookings
          .filter((booking) => !!booking.timeBegin && !!booking.timeEnd)
          .filter(
            (booking, index, self) =>
              self.findIndex((b) => b.id === booking.id) === index,
          )
          .map((booking) => {
            return {
              bookableId: bookable.id,
              title: bookable.title,
              timeBegin: booking.timeBegin,
              timeEnd: booking.timeEnd,
            };
          }),
      );
    }

    response.status(200).send(occupancies);
  }
}

module.exports = CalendarController;
