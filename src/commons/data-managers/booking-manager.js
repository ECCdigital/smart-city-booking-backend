const validate = require("jsonschema").validate;

const { isRangeOverlap } = require("range-overlap");
const { Booking } = require("../entities/booking");
const dbm = require("../utilities/database-manager");

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
  static getBookings(tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("bookings")
        .find({ tenant: tenant })
        .toArray()
        .then((rawBookings) => {
          var bookings = rawBookings.map((rb) => {
            return new Booking(rb);
          });

          resolve(bookings);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Get all bookings related to a bookable object.
   *
   * @param {string} tenant Identifier of the tenant
   * @param bookableId
   * @returns List of bookings
   * @returns
   */
  static getRelatedBookings(tenant, bookableId) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("bookings")
        .find({ tenant: tenant, "bookableItems.bookableId": bookableId })
        .toArray()
        .then((rawBookings) => {
          var bookings = rawBookings.map((rb) => {
            return Object.assign(new Booking(), rb);
          });

          resolve(bookings);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Get all bookings related to a user
   *
   * @param {string} tenant Identifier of the tenant
   * @returns List of bookings
   */
  static getAssignedBookings(tenant, userId) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("bookings")
        .find({ tenant: tenant, assignedUserId: userId })
        .toArray()
        .then((rawBookings) => {
          var bookings = rawBookings.map((rb) => {
            return Object.assign(new Booking(), rb);
          });

          resolve(bookings);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Get a specific booking object from the database.
   *
   * @param {string} id Logical identifier of the booking object
   * @param {string} tenant Identifier of the tenant
   * @returns A single bookable object
   */
  static getBooking(id, tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("bookings")
        .findOne({ id: id, tenant: tenant })
        .then((rawBooking) => {
          const booking = new Booking(rawBooking);
          resolve(booking);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Get the status of a booking.
   *
   * @param tenant
   * @param bookingId
   * @returns {Promise<>} status of the booking
   */
  static async getBookingStatus(tenant, bookingId) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("bookings")
        .findOne({ tenant: tenant, id: bookingId })
        .then((rawBooking) => {
          const booking = Object.assign(new Booking(), rawBooking);
          const bookingStatus = {
            isCommitted: booking.isCommitted,
            isPayed: booking.isPayed,
            bookingId: booking.id,
          };

          resolve(bookingStatus);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Insert a booking object into the database or update it.
   *
   * @param {Booking} booking The booking object to be stored.
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns Promise<>
   */
  static storeBooking(booking, upsert = true) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("bookings")
        .replaceOne({ id: booking.id, tenant: booking.tenant }, booking, {
          upsert: upsert,
        })
        .then(() => resolve())
        .catch((err) => reject(err));
    });
  }

  /**
   * Remove a booking object from the database.
   *
   * @param {string} id Id of the booking
   * @param {string} tenant Identifier of the tenant
   * @returns Promise<>
   */
  static removeBooking(id, tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("bookings")
        .deleteOne({ id: id, tenant: tenant })
        .then(() => resolve())
        .catch((err) => reject(err));
    });
  }

  /**
   * Get all bookings related to a Bookable that conflict with a certain time window.
   *
   * @param {integer} bookableId ID of the related Bookable
   * @param {string} tenant Identifier of the tenant
   * @param {number} timeBegin Begin Timestamp
   * @param {number} timeEnd End Timestamp
   * @returns
   */
  static getConcurrentBookings(bookableId, tenant, timeBegin, timeEnd) {
    return new Promise((resolve, reject) => {
      BookingManager.getRelatedBookings(tenant, bookableId)
        .then((bookings) => {
          var concurrentBookings = bookings.filter(
            (b) =>
              isRangeOverlap(
                b.timeBegin,
                b.timeEnd,
                timeBegin,
                timeEnd,
                true,
              ) && !b.isRejected,
          );

          resolve(concurrentBookings);
        })
        .catch((err) => reject(err));
    });
  }

  static getBookingsByTimeRange(tenant, timeBegin, timeEnd) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("bookings")
        .find({
          tenant: tenant,
          $or: [
            { timeBegin: { $gte: timeBegin, $lt: timeEnd } },
            { timeEnd: { $gt: timeBegin, $lte: timeEnd } },
          ],
        })
        .toArray()
        .then((rawBookings) => {
          var bookings = rawBookings.map((rb) => {
            return Object.assign(new Booking(rb));
          });

          resolve(bookings);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Update committed status of a booking object.
   *
   * @param {Booking} booking The booking object to be updated.
   * @returns Promise<>
   */
  static setBookingPayedStatus(booking) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("bookings")
        .replaceOne({ id: booking.id, tenant: booking.tenant }, booking)
        .then(() => resolve())
        .catch((err) => reject(err));
    });
  }

  /**
   * Get all bookings related to an event.
   *
   * @param {string} tenant Identifier of the tenant
   * @param {string} eventId Identifier of the event
   * @returns {Promise<>} List of bookings
   */
  static getEventBookings(tenant, eventId) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("bookables")
        .find({ tenant: tenant, eventId: eventId, type: "ticket" })
        .toArray()
        .then((rawBookables) => {
          let bookableIds = rawBookables.map((rb) => rb.id);
          dbm
            .get()
            .collection("bookings")
            .find({
              tenant: tenant,
              "bookableItems.bookableId": { $in: bookableIds },
            })
            .toArray()
            .then((rawBookings) => {
              let bookings = rawBookings.map((rb) =>
                Object.assign(new Booking(rb)),
              );
              resolve(bookings);
            })
            .catch((err) => reject(err));
        })
        .catch((err) => reject(err));
    });
  }

  static async getBookingsCustomFilter(tenant, filter) {
    try {
      const bookings = await dbm
        .get()
        .collection("bookings")
        .find({ tenant: tenant, ...filter })
        .toArray();
      return bookings.map((b) => Object.assign(new Booking(b)));
    } catch {
      return null;
    }
  }
}

module.exports = BookingManager;
