const { isRangeOverlap } = require("range-overlap");
const { Booking } = require("../entities/booking/booking");
const BookingModel = require("./models/bookingModel");
const BookableModel = require("./models/bookableModel");

/**
 * Data Manager for Booking objects.
 */
class BookingManager {
  /**
   * Get all bookings related to a tenant
   * @param {string} tenantId Identifier of the tenant
   * @returns {Promise<Booking[]>} List of bookings
   */
  static async getTenantBookings(tenantId) {
    const rawBookings = await BookingModel.find({ tenantId: tenantId });
    return rawBookings.map((doc) => doc.toEntity());
  }

  /**
   * Get bookings by IDs
   * @param {string} tenantId Identifier of the tenant
   * @param {string[]} bookingIds Array of booking IDs
   * @returns {Promise<Booking[]>} List of bookings
   */
  static async getBookings(tenantId, bookingIds) {
    const rawBookings = await BookingModel.find({
      tenantId: tenantId,
      id: { $in: bookingIds },
    });
    return rawBookings.map((doc) => doc.toEntity());
  }

  /**
   * Get all bookings related to a bookable object
   * @param {string} tenantId Identifier of the tenant
   * @param {string} bookableId Bookable ID
   * @returns {Promise<Booking[]>} List of bookings
   */
  static async getRelatedBookings(tenantId, bookableId) {
    const rawBookings = await BookingModel.find({
      tenantId: tenantId,
      "bookableItems.bookableId": bookableId,
    });
    return rawBookings.map((doc) => doc.toEntity());
  }

  /**
   * Get bookings related to multiple bookables
   * @param {string} tenantId Identifier of the tenant
   * @param {string[]} bookableIds Array of bookable IDs
   * @returns {Promise<Booking[]>} List of bookings
   */
  static async getRelatedBookingsBatch(tenantId, bookableIds) {
    const rawBookings = await BookingModel.find({
      tenantId: tenantId,
      "bookableItems.bookableId": { $in: bookableIds },
    });
    return rawBookings.map((doc) => doc.toEntity());
  }

  /**
   * Get all bookings assigned to a user
   * @param {string} tenantId Identifier of the tenant
   * @param {string} userId Identifier of the user
   * @returns {Promise<Booking[]>} List of bookings
   */
  static async getAssignedBookings(tenantId, userId) {
    const rawBookings = await BookingModel.find({
      tenantId: tenantId,
      assignedUserId: userId,
    });
    return rawBookings.map((doc) => doc.toEntity());
  }

  /**
   * Get a specific booking
   * @param {string} id Booking ID
   * @param {string} tenantId Tenant ID
   * @returns {Promise<Booking|null>} Booking or null
   */
  static async getBooking(id, tenantId) {
    const rawBooking = await BookingModel.findOne({
      id: id,
      tenantId: tenantId,
    });

    if (!rawBooking) {
      return null;
    }

    return rawBooking.toEntity();
  }

  /**
   * Get booking status information
   * @param {string} tenantId Tenant ID
   * @param {string[]} bookingIds Array of booking IDs
   * @returns {Promise<Object[]>} Array of booking status objects
   */
  static async getBookingStatus(tenantId, bookingIds) {
    const bookings = await BookingManager.getBookings(tenantId, bookingIds);
    return bookings.map((booking) => booking.exportStatus());
  }

  /**
   * Store a booking (create or update)
   * @param {Booking|Object} booking Booking to store
   * @param {boolean} upsert Whether to create if not exists
   * @returns {Promise<Booking>} The stored booking
   */
  static async storeBooking(booking, upsert = true) {
    const bookingEntity =
      booking instanceof Booking ? booking : new Booking(booking);

    bookingEntity.validate();

    await BookingModel.updateOne(
      { id: bookingEntity.id, tenantId: bookingEntity.tenantId },
      bookingEntity,
      { upsert: upsert },
    );

    return bookingEntity;
  }

  /**
   * Remove a booking
   * @param {string} id Booking ID
   * @param {string} tenantId Tenant ID
   * @returns {Promise<void>}
   */
  static async removeBooking(id, tenantId) {
    await BookingModel.deleteOne({ id: id, tenantId: tenantId });
  }

  /**
   * Get concurrent bookings for a bookable in a time window
   * @param {string} bookableId Bookable ID
   * @param {string} tenantId Tenant ID
   * @param {number} timeBegin Start time
   * @param {number} timeEnd End time
   * @param {string|null} bookingToIgnore Booking ID to ignore
   * @returns {Promise<Booking[]>} Concurrent bookings
   */
  static async getConcurrentBookings(
    bookableId,
    tenantId,
    timeBegin,
    timeEnd,
    bookingToIgnore = null,
  ) {
    const relatedBookings = await BookingManager.getRelatedBookings(tenantId, bookableId);

    return relatedBookings.filter(
      (booking) =>
        isRangeOverlap(
          booking.timeBegin,
          booking.timeEnd,
          timeBegin,
          timeEnd,
          true,
        ) &&
        !booking.isRejected &&
        booking.id !== bookingToIgnore,
    );
  }

  /**
   * Get bookings in a time range
   * @param {string} tenantId Tenant ID
   * @param {number} timeBegin Start time
   * @param {number} timeEnd End time
   * @returns {Promise<Booking[]>} Bookings in time range
   */
  static async getBookingsByTimeRange(tenantId, timeBegin, timeEnd) {
    const rawBookings = await BookingModel.find({
      tenantId: tenantId,
      $or: [
        { timeBegin: { $gte: timeBegin, $lt: timeEnd } },
        { timeEnd: { $gt: timeBegin, $lte: timeEnd } },
      ],
    });
    return rawBookings.map((doc) => doc.toEntity());
  }

  /**
   * Update payment status of a booking
   * @param {Booking} booking Booking with updated payment info
   * @returns {Promise<void>}
   */
  static async setBookingPayedStatus(booking) {
    await BookingModel.updateOne(
      { id: booking.id, tenantId: booking.tenantId },
      {
        isPayed: booking.isPayed,
        paymentMethod: booking.paymentMethod,
      },
    );
  }

  /**
   * Get bookings for an event
   * @param {string} tenantId Tenant ID
   * @param {string} eventId Event ID
   * @returns {Promise<Booking[]>} Event bookings
   */
  static async getEventBookings(tenantId, eventId) {
    const bookables = await BookableModel.find({
      tenantId: tenantId,
      eventId: eventId,
      type: "ticket",
    });

    const bookableIds = bookables.map((b) => b.id);
    return await BookingManager.getRelatedBookingsBatch(tenantId, bookableIds);
  }

  /**
   * Get bookings with custom filter
   * @param {string} tenantId Tenant ID
   * @param {Object} filter MongoDB filter object
   * @returns {Promise<Booking[]>} Filtered bookings
   */
  static async getBookingsCustomFilter(tenantId, filter) {
    const rawBookings = await BookingModel.find({
      tenantId: tenantId,
      ...filter,
    });
    return rawBookings.map((doc) => doc.toEntity());
  }
}

module.exports = BookingManager;
