/**
 * The store adapter of the booking lifecycle seam: `BookingManager` behind
 * the interface the lifecycle speaks (spec part 2, sections 5 and 10).
 *
 * `save` is the conditional write: it writes only where the stored booking
 * is in `expectStatus` and answers the document as it was before, the
 * snapshot an abort restores with `restore`. Where the write finds no
 * match, the state is read and the guard's `ConflictError
 * invalid_transition` raised with it, so two transitions racing for one
 * booking end with exactly one state change.
 */

const BookingManager = require("../../../data-managers/booking-manager");
const TenantManager = require("../../../data-managers/tenant-manager");
const {
  ConflictError,
  NotFoundError,
} = require("../../../../errors/BaseError");

const store = {
  /**
   * @param {string} tenantId
   * @param {string} bookingId
   * @returns {Promise<Object|null>} The booking, or null
   */
  async get(tenantId, bookingId) {
    return await BookingManager.getBooking(bookingId, tenantId);
  },

  /**
   * @param {string} tenantId
   * @param {string[]} bookingIds
   * @returns {Promise<Object[]>} The bookings found
   */
  async getMany(tenantId, bookingIds) {
    return await BookingManager.getBookings(tenantId, bookingIds);
  },

  /**
   * The tenant a booking belongs to, for what a transition reads off it
   * (the refund tiers of a cancellation).
   *
   * @param {string} tenantId
   * @returns {Promise<Object|null>} The tenant, or null
   */
  async getTenant(tenantId) {
    return await TenantManager.getTenant(tenantId);
  },

  /**
   * @param {Object} booking The booking to store
   * @param {{ expectStatus: string, transition: string, unset?: string[] }} options
   *   The state the stored booking must be in, the transition for the guard
   *   error, and fields the write removes from the document
   * @returns {Promise<Object>} The document as it was before the write
   * @throws {ConflictError} `invalid_transition` where the booking is in
   *   another state
   * @throws {NotFoundError} `booking_not_found` where the booking is gone
   */
  async save(booking, { expectStatus, transition, unset = [] } = {}) {
    if (!expectStatus) {
      throw new Error(
        "booking-lifecycle: store.save needs expectStatus, the state the booking is written from",
      );
    }
    const previous = await BookingManager.storeBookingIfStatus(
      booking,
      expectStatus,
      { unset },
    );
    if (previous) {
      return previous;
    }

    const current = await BookingManager.getBooking(
      booking.id,
      booking.tenantId,
    );
    if (!current) {
      throw new NotFoundError("booking_not_found", { bookingId: booking.id });
    }
    throw new ConflictError("invalid_transition", {
      bookingId: booking.id,
      status: current.status,
      transition,
    });
  },

  /**
   * Puts a previous document back as a whole.
   *
   * @param {Object} previous What `save` answered
   * @returns {Promise<void>}
   */
  async restore(previous) {
    await BookingManager.replaceBooking(previous);
  },
};

module.exports = store;
