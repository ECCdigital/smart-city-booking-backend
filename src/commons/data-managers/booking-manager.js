const validate = require("jsonschema").validate;

const { isRangeOverlap } = require("range-overlap");
const { Booking } = require("../entities/booking");

const mongoose = require("mongoose");
const { BookableModel } = require("./bookable-manager");
const { Schema } = mongoose;

const BookingSchema = new Schema(Booking.schema());
const BookingModel =
  mongoose.models.Booking || mongoose.model("Booking", BookingSchema);

/**
 * Data Manager for Booking objects.
 */
class BookingManager {
  /**
   * Check if an object is a valid Booking.
   *
   * @param {object} booking A booking object
   * @returns true, if the object is a valid booking object
   */
  static validateBooking(booking) {
    var schema = require("../schemas/booking.schema.json");
    return validate(booking, schema).errors.length === 0;
  }

  /**
   * Get all bookings related to a tenant
   *
   * @param {string} tenant Identifier of the tenant
   * @returns List of bookings
   */
  static async getBookings(tenant) {
    const rawBookings = await BookingModel.find({ tenant: tenant });
    return rawBookings.map((rb) => new Booking(rb));
  }

  /**
   * Get all bookings related to a bookable object.
   *
   * @param {string} tenant Identifier of the tenant
   * @param bookableId
   * @returns List of bookings
   * @returns
   */
  static async getRelatedBookings(tenant, bookableId) {
    const rawBookings = await BookingModel.find({
      tenant: tenant,
      "bookableItems.bookableId": bookableId,
    });
    return rawBookings.map((rb) => new Booking(rb));
  }

  static async getRelatedBookingsBatch(tenant, bookableIds) {
    const rawBookings = await BookingModel.find({
      tenant: tenant,
      "bookableItems.bookableId": { $in: bookableIds },
    });
    return rawBookings.map((rb) => new Booking(rb));
  }

  /**
   * Get all bookings related to a user
   *
   * @param {string} tenant Identifier of the tenant
   * @param {string} userId Identifier of the user
   * @returns List of bookings
   */
  static async getAssignedBookings(tenant, userId) {
    const rawBookings = await BookingModel.find({
      tenant: tenant,
      assignedUserId: userId,
    });
    return rawBookings.map((rb) => new Booking(rb));
  }

  /**
   * Get a specific booking object from the database.
   *
   * @param {string} id Logical identifier of the booking object
   * @param {string} tenantId Identifier of the tenant
   * @returns A single bookable object
   */
  static async getBooking(id, tenantId) {
    const rawBooking = await BookingModel.findOne({ id: id, tenantId: tenantId });
    if(!rawBooking) {
      return null;
    }
    return new Booking(rawBooking);
  }

  /**
   * Get the status of a booking.
   *
   * @param tenantId
   * @param bookingId
   * @returns {Promise<>} status of the booking
   */
  static async getBookingStatus(tenantId, bookingId) {
    const rawBooking = await BookingModel.findOne({
      id: bookingId,
      tenantId: tenantId,
    });
    const booking = new Booking(rawBooking);
    return {
      isCommitted: booking.isCommitted,
      isPayed: booking.isPayed,
      bookingId: booking.id,
    };
  }

  /**
   * Insert a booking object into the database or update it.
   *
   * @param {Booking} booking The booking object to be stored.
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns Promise<>
   */
  static async storeBooking(booking, upsert = true) {
    await BookingModel.updateOne(
      { id: booking.id, tenantId: booking.tenantId },
      booking,
      { upsert: upsert },
    );
  }

  /**
   * Remove a booking object from the database.
   *
   * @param {string} id Id of the booking
   * @param {string} tenantId Identifier of the tenant
   * @returns Promise<>
   */
  static async removeBooking(id, tenantId) {
    await BookingModel.deleteOne({ id: id, tenantId: tenantId });
  }

  /**
   * Get all bookings related to a Bookable that conflict with a certain time window.
   *
   * @param {integer} bookableId ID of the related Bookable
   * @param {string} tenantId Identifier of the tenant
   * @param {number} timeBegin Begin Timestamp
   * @param {number} timeEnd End Timestamp
   * @param bookingToIgnore ID of a booking that should be ignored
   * @returns
   */
  static async getConcurrentBookings(
    bookableId,
    tenantId,
    timeBegin,
    timeEnd,
    bookingToIgnore = null,
  ) {
    const rawBookings = await BookingManager.getRelatedBookings(
      tenantId,
      bookableId,
    );
    const concurrentBookings = rawBookings.filter(
      (b) =>
        isRangeOverlap(b.timeBegin, b.timeEnd, timeBegin, timeEnd, true) &&
        !b.isRejected &&
        b.id !== bookingToIgnore,
    );

    return concurrentBookings.map((cb) => new Booking(cb));
  }

  static getBookingsByTimeRange(tenantId, timeBegin, timeEnd) {
    const rawBookings = BookingModel.find({
      tenantId: tenantId,
      $or: [
        { timeBegin: { $gte: timeBegin, $lt: timeEnd } },
        { timeEnd: { $gt: timeBegin, $lte: timeEnd } },
      ],
    });
    return rawBookings.map((rb) => new Booking(rb));
  }

  /**
   * Update committed status of a booking object.
   *
   * @param {Booking} booking The booking object to be updated.
   * @returns Promise<>
   */
  static async setBookingPayedStatus(booking) {
    await BookingModel.updateOne(
      { id: booking.id, tenantId: booking.tenantId },
      { isPayed: booking.isPayed },
    );
  }

  /**
   * Get all bookings related to an event.
   *
   * @param {string} tenantId Identifier of the tenant
   * @param {string} eventId Identifier of the event
   * @returns {Promise<>} List of bookings
   */
  static async getEventBookings(tenantId, eventId) {
    const bookables = await BookableModel.find({
      tenantId: tenantId,
      eventId: eventId,
      type: "ticket",
    });
    const bookableIds = bookables.map((b) => b.id);
    const rawBookings = await BookingModel.find({
      tenantId: tenantId,
      "bookableItems.bookableId": { $in: bookableIds },
    });
    return rawBookings.map((rb) => new Booking(rb));
  }
}

module.exports = BookingManager;
