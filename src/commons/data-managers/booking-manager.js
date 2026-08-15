const { isRangeOverlap } = require("range-overlap");
const {
  overlapsBufferedInterval,
  widenQueryWindow,
} = require("../availability/booking-buffer");
const { Booking } = require("../entities/booking/booking");
const BookingModel = require("./models/bookingModel");
const BookableModel = require("./models/bookableModel");
const { BookableManager } = require("./bookable-manager");

/**
 * Data Manager for Booking objects.
 */
class BookingManager {
  static async _toEntities(rawBookings) {
    const bookings = rawBookings.map((doc) => doc.toEntity());
    await BookingManager._enrichBookingsWithCustomFields(bookings);
    return bookings;
  }

  static async _enrichBookingsWithCustomFields(bookings) {
    if (!bookings.length) {
      return bookings;
    }

    const bookingsByTenant = bookings.reduce((groups, booking) => {
      if (!groups.has(booking.tenantId)) {
        groups.set(booking.tenantId, []);
      }
      groups.get(booking.tenantId).push(booking);
      return groups;
    }, new Map());

    await Promise.all(
      [...bookingsByTenant.entries()].map(
        async ([tenantId, tenantBookings]) => {
          const { instanceFields, tenantFields } =
            await BookableManager.getCustomFieldDefinitions(tenantId);

          const bookableIds = [
            ...new Set(
              tenantBookings.flatMap((booking) =>
                booking.bookableItems.map((item) => item.bookableId),
              ),
            ),
          ];

          const bookables = await BookableManager.getBookablesByIds(
            tenantId,
            bookableIds,
          );
          const bookableFieldsById = new Map(
            bookables.map((bookable) => [
              bookable.id,
              bookable.customFieldDefinitions || [],
            ]),
          );

          for (const booking of tenantBookings) {
            const bookingBookableIds = [
              ...new Set(booking.bookableItems.map((item) => item.bookableId)),
            ];
            const bookableFields = bookingBookableIds.flatMap(
              (bookableId) => bookableFieldsById.get(bookableId) || [],
            );

            booking.enrichCustomFields({
              instanceFields,
              tenantFields,
              bookableFields,
            });
          }
        },
      ),
    );

    return bookings;
  }

  /**
   * Get all bookings related to a tenant
   * @param {string} tenantId Identifier of the tenant
   * @returns {Promise<Booking[]>} List of bookings
   */
  static async getTenantBookings(tenantId) {
    const rawBookings = await BookingModel.find({ tenantId: tenantId });
    return BookingManager._toEntities(rawBookings);
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
    return BookingManager._toEntities(rawBookings);
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
    return BookingManager._toEntities(rawBookings);
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
    return BookingManager._toEntities(rawBookings);
  }

  /**
   * Get all bookings assigned to a user
   * @param {Object} params Parameters object
   * @param {string} params.userID User ID
   * @param {Object} [params.filter={}] Additional filter options
   * @returns {Promise<Booking[]>} List of bookings
   */
  static async getAssignedBookings({ userID, filter = {} }) {
    const rawBookings = await BookingModel.find({
      assignedUserId: userID,
      ...filter,
    });
    return BookingManager._toEntities(rawBookings);
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

    const [booking] = await BookingManager._toEntities([rawBooking]);
    return booking;
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
   * @param {{ unset?: string[] }} [options] Optional fields to remove via $unset
   * @returns {Promise<Booking>} The stored booking
   */
  static async storeBooking(booking, upsert = true, options = {}) {
    const bookingEntity =
      booking instanceof Booking ? booking : new Booking(booking);

    bookingEntity.validate();

    const unsetFields = Array.isArray(options.unset) ? options.unset : [];
    const filter = { id: bookingEntity.id, tenantId: bookingEntity.tenantId };

    if (unsetFields.length === 0) {
      await BookingModel.updateOne(filter, bookingEntity, { upsert });
      return bookingEntity;
    }

    for (const field of unsetFields) {
      delete bookingEntity[field];
    }

    await BookingModel.updateOne(
      filter,
      {
        $set: bookingEntity,
        $unset: Object.fromEntries(unsetFields.map((field) => [field, ""])),
      },
      { upsert },
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
    const relatedBookings = await BookingManager.getRelatedBookings(
      tenantId,
      bookableId,
    );

    return BookingManager.filterConcurrentBookings(
      relatedBookings,
      timeBegin,
      timeEnd,
      bookingToIgnore,
    );
  }

  /**
   * Filter bookings that overlap a time window.
   * @param {Booking[]} bookings
   * @param {number} timeBegin
   * @param {number} timeEnd
   * @param {string|null} bookingToIgnore
   * @param {{ beforeMs?: number, afterMs?: number }} [buffer]
   * @returns {Booking[]}
   */
  static filterConcurrentBookings(
    bookings,
    timeBegin,
    timeEnd,
    bookingToIgnore = null,
    buffer = { beforeMs: 0, afterMs: 0 },
  ) {
    const { beforeMs = 0, afterMs = 0 } = buffer;
    const useBuffer = beforeMs > 0 || afterMs > 0;
    const queryWindow = useBuffer
      ? widenQueryWindow(timeBegin, timeEnd, beforeMs, afterMs)
      : { timeBegin, timeEnd };

    return bookings.filter((booking) => {
      if (booking.isRejected || booking.id === bookingToIgnore) {
        return false;
      }

      if (useBuffer) {
        return overlapsBufferedInterval(
          timeBegin,
          timeEnd,
          booking.timeBegin,
          booking.timeEnd,
          beforeMs,
          afterMs,
        );
      }

      return isRangeOverlap(
        booking.timeBegin,
        booking.timeEnd,
        queryWindow.timeBegin,
        queryWindow.timeEnd,
        true,
      );
    });
  }

  /**
   * Load bookings for a bookable family in a single query, scoped to a time range.
   * @param {string} tenantId
   * @param {string[]} bookableIds
   * @param {number} timeBegin
   * @param {number} timeEnd
   * @returns {Promise<Booking[]>}
   */
  static async getBookingsForBookableFamily(
    tenantId,
    bookableIds,
    timeBegin,
    timeEnd,
  ) {
    if (!bookableIds.length) {
      return [];
    }

    const rawBookings = await BookingModel.find({
      tenantId: tenantId,
      "bookableItems.bookableId": { $in: bookableIds },
      isRejected: { $ne: true },
      timeBegin: { $lt: timeEnd },
      timeEnd: { $gt: timeBegin },
    });

    return rawBookings.map((doc) => doc.toEntity());
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
    return BookingManager._toEntities(rawBookings);
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

  static async getBookedSeatsCount(
    tenantId,
    eventId,
    { onlyOwn = false, userId = null } = {},
  ) {
    const matchStage = {
      tenantId: tenantId,
      isRejected: false,
      "bookableItems._bookableUsed.eventId": eventId,
      ...(onlyOwn ? { "bookableItems._bookableUsed.ownerUserId": userId } : {}),
    };

    const result = await BookingModel.aggregate([
      { $match: matchStage },
      { $unwind: "$bookableItems" },
      {
        $match: {
          "bookableItems._bookableUsed.eventId": eventId,
          ...(onlyOwn
            ? { "bookableItems._bookableUsed.ownerUserId": userId }
            : {}),
        },
      },
      {
        $group: {
          _id: null,
          totalSeats: {
            $sum: {
              $toInt: {
                $ifNull: ["$bookableItems.amount", 0],
              },
            },
          },
        },
      },
    ]);

    return result.length > 0 ? result[0].totalSeats : 0;
  }

  static async reassignUserReferences(
    previousUserId,
    newUserId,
    session = null,
  ) {
    const options = session ? { session } : {};

    await BookingModel.updateMany(
      { assignedUserId: previousUserId },
      { $set: { assignedUserId: newUserId } },
      options,
    );

    await BookingModel.updateMany(
      { mail: previousUserId },
      { $set: { mail: newUserId } },
      options,
    );

    await BookingModel.updateMany(
      { "bookableItems._bookableUsed.ownerUserId": previousUserId },
      {
        $set: {
          "bookableItems.$[item]._bookableUsed.ownerUserId": newUserId,
        },
      },
      {
        ...options,
        arrayFilters: [{ "item._bookableUsed.ownerUserId": previousUserId }],
      },
    );
  }

  static async updateAssignedSelfBookingNames(userId, fullName) {
    await BookingModel.updateMany(
      {
        assignedUserId: userId,
        mail: userId,
      },
      { $set: { name: fullName } },
    );
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
    return BookingManager._toEntities(rawBookings);
  }

  /**
   * Get committed, non-rejected bookings of a single user (the assigned user),
   * narrowed down at the database level. Used by the access/booking queries to
   * avoid loading the whole tenant.
   *
   * The price/payment validity (`isPayed` for priced bookings) is intentionally
   * NOT enforced here - it depends on `priceEur` and is re-checked in memory via
   * `Booking.isBookingValid()`.
   *
   * @param {string|null} tenantId Tenant ID, or null/undefined to search across all tenants
   * @param {string} userId Assigned user ID
   * @param {Object} [opts]
   * @param {Object} [opts.timeFilter={}] Extra time conditions (e.g. on timeBegin/timeEnd)
   * @param {Object} [opts.match={}] Extra MongoDB conditions (e.g. bookable/locker $or)
   * @param {boolean} [opts.requireCommitted=true] When false, also returns uncommitted bookings
   * @returns {Promise<Booking[]>} List of bookings
   */
  static async getUserBookingsFiltered(
    tenantId,
    userId,
    { timeFilter = {}, match = {}, requireCommitted = true } = {},
  ) {
    const rawBookings = await BookingModel.find({
      ...(tenantId ? { tenantId: tenantId } : {}),
      assignedUserId: userId,
      ...(requireCommitted ? { isCommitted: true } : {}),
      isRejected: false,
      ...timeFilter,
      ...match,
    });
    return rawBookings.map((doc) => doc.toEntity());
  }
}

module.exports = BookingManager;
