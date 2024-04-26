const BookingManager = require("../data-managers/booking-manager");
const UserManager = require("../data-managers/user-manager");
const { Booking } = require("../entities/booking");

/**
 * The User Utilities provide tools and functionality exceeding
 * pure data management regarding user management.
 */
class UserUtilities {
  /**
   * Determine guest bookings with same mail-address as a user and
   * link those objects to the user. This method is used especially
   * for users who sign up to the platform and having made guest
   * bookings before.
   *
   * @param {*} userId Id of the user
   * @param {*} tenant Identifier of the tenant
   */
  static async linkGuestBookingsToUser(userId, tenant) {
    var user = await UserManager.getUser(userId, tenant);
    var bookings = await BookingManager.getBookings(tenant);

    var relatedBookings = bookings.filter(
      (b) => b.mail.toLowerCase() === user.id.toLowerCase(),
    );

    for (var booking of relatedBookings) {
      var newBooking = Object.assign(new Booking(), booking);
      newBooking.assignedUserId = userId;
      await BookingManager.storeBooking(newBooking);
    }
  }
}

module.exports = UserUtilities;
