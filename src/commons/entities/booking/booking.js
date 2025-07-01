const { bookingSchemaDefinition } = require("../../schemas/bookingSchema");
const SchemaUtils = require("../../utilities/schemaUtils");
const { BookingHook, BOOKING_HOOK_TYPES } = require("./bookingHook");

class Booking {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(bookingSchemaDefinition);
    Object.assign(this, defaults, params);

    // Convert hooks to BookingHook entities
    if (this.hooks && Array.isArray(this.hooks)) {
      this.hooks = this.hooks.map((hook) =>
        hook instanceof BookingHook ? hook : new BookingHook(hook),
      );
    }
  }

  /**
   * Add a hook to the booking
   * @param {string} type Hook type
   * @param {Object} payload Hook payload
   * @returns {BookingHook} The created hook
   */
  addHook(type, payload) {
    const hook = BookingHook.create({ type, payload });
    this.hooks.push(hook);
    return hook;
  }

  /**
   * Remove a hook from the booking
   * @param {string} hookId Hook ID to remove
   */
  removeHook(hookId) {
    const hookIndex = this.hooks.findIndex((hook) => hook.id === hookId);
    if (hookIndex === -1) {
      throw new Error(`Hook with ID ${hookId} not found`);
    }
    this.hooks.splice(hookIndex, 1);
  }

  /**
   * Get a hook by ID
   * @param {string} hookId Hook ID
   * @returns {BookingHook|null} The hook or null if not found
   */
  getHook(hookId) {
    return this.hooks.find((hook) => hook.id === hookId) || null;
  }

  /**
   * Get hooks by type
   * @param {string} type Hook type
   * @returns {BookingHook[]} Array of hooks
   */
  getHooksByType(type) {
    return this.hooks.filter((hook) => hook.type === type);
  }

  /**
   * Check if booking is in a specific time range
   * @param {number} timeBegin Start time
   * @param {number} timeEnd End time
   * @returns {boolean} True if booking overlaps with time range
   */
  isInTimeRange(timeBegin, timeEnd) {
    return this.timeBegin < timeEnd && this.timeEnd > timeBegin;
  }

  /**
   * Check if booking conflicts with another booking
   * @param {Booking} otherBooking Other booking to check against
   * @returns {boolean} True if bookings conflict
   */
  conflictsWith(otherBooking) {
    if (this.isRejected || otherBooking.isRejected) {
      return false;
    }

    return this.isInTimeRange(otherBooking.timeBegin, otherBooking.timeEnd);
  }

  /**
   * Get booking duration in milliseconds
   * @returns {number} Duration in milliseconds
   */
  getDuration() {
    return this.timeEnd - this.timeBegin;
  }

  /**
   * Check if booking involves a specific bookable
   * @param {string} bookableId Bookable ID to check
   * @returns {boolean} True if booking involves the bookable
   */
  involvesBookable(bookableId) {
    return this.bookableItems.some((item) => item.bookableId === bookableId);
  }

  /**
   * Get total price including VAT
   * @returns {number} Total price
   */
  getTotalPrice() {
    return this.priceEur + this.vatIncludedEur;
  }

  /**
   * Export booking status information
   * @returns {Object} Status information
   */
  exportStatus() {
    return {
      bookingId: this.id,
      priceEur: this.priceEur,
      timeBegin: this.timeBegin,
      timeEnd: this.timeEnd,
      isCommitted: this.isCommitted,
      isPayed: this.isPayed,
      isRejected: this.isRejected,
    };
  }

  /**
   * Export public booking information (without sensitive data)
   * @returns {Object} Public booking data
   */
  exportPublic() {
    return {
      id: this.id,
      timeBegin: this.timeBegin,
      timeEnd: this.timeEnd,
      isCommitted: this.isCommitted,
      isPayed: this.isPayed,
      isRejected: this.isRejected,
      priceEur: this.priceEur,
      bookableItems: this.bookableItems,
    };
  }

  validate() {
    SchemaUtils.validate(this, bookingSchemaDefinition);

    if (this.priceEur < 0) {
      throw new Error("Price cannot be negative");
    }

    return true;
  }

  static create(params) {
    const booking = new Booking(params);
    booking.validate();
    return booking;
  }
}

module.exports = {
  Booking,
  BOOKING_HOOK_TYPES,
};
