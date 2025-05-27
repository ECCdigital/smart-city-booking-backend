const BookingManager = require("../data-managers/booking-manager");
const UserManager = require("../data-managers/user-manager");

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
    const user = await UserManager.getUser(userId, tenant);
    const bookings = await BookingManager.getTenantBookings(tenant);

    const relatedBookings = bookings.filter(
      (b) => b.mail.toLowerCase() === user.id.toLowerCase(),
    );

    for (const booking of relatedBookings) {
      const newBooking = Object.assign(
        Object.create(Object.getPrototypeOf(booking)),
        booking,
      );
      newBooking.assignedUserId = userId;
      await BookingManager.storeBooking(newBooking);
    }
  }
}

module.exports = UserUtilities;
