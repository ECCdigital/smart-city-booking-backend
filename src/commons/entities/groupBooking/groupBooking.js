const {
  groupBookingSchemaDefinition,
} = require("../../schemas/groupBookingSchema");
const SchemaUtils = require("../../utilities/schemaUtils");
const {
  GroupBookingHook,
  GROUP_BOOKING_HOOK_TYPES,
} = require("./groupBookingHook");

class GroupBooking {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(groupBookingSchemaDefinition);
    Object.assign(this, defaults, params);

    if (this.hooks && Array.isArray(this.hooks)) {
      this.hooks = this.hooks.map((hook) =>
        hook instanceof GroupBookingHook ? hook : new GroupBookingHook(hook),
      );
    }

    if (params.bookings && Array.isArray(params.bookings)) {
      this.bookings = params.bookings.map((booking) => {
        const { Booking } = require("../booking/booking");
        return booking instanceof Booking ? booking : new Booking(booking);
      });
    } else {
      this.bookings = [];
    }
  }

  /**
   * Add a booking ID to the group
   * @param {string} bookingId Booking ID to add
   */
  addBookingId(bookingId) {
    if (!this.bookingIds.includes(bookingId)) {
      this.bookingIds.push(bookingId);
    }
  }

  /**
   * Remove a booking ID from the group
   * @param {string} bookingId Booking ID to remove
   */
  removeBookingId(bookingId) {
    this.bookingIds = this.bookingIds.filter((id) => id !== bookingId);
  }

  /**
   * Add a hook to the group booking
   * @param {string} type Hook type
   * @param {Object} payload Hook payload
   * @returns {GroupBookingHook} The created hook
   */
  addHook(type, payload) {
    const hook = GroupBookingHook.create({ type, payload });
    this.hooks.push(hook);
    return hook;
  }

  /**
   * Remove a hook from the group booking
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
   * @returns {GroupBookingHook|null} The hook or null if not found
   */
  getHook(hookId) {
    return this.hooks.find((hook) => hook.id === hookId) || null;
  }

  /**
   * Get hooks by type
   * @param {string} type Hook type
   * @returns {GroupBookingHook[]} Array of hooks
   */
  getHooksByType(type) {
    return this.hooks.filter((hook) => hook.type === type);
  }

  /**
   * Get total price of all bookings
   * @returns {number} Total price
   */
  getTotalPrice() {
    return this.bookings.reduce((total, booking) => {
      return total + (booking.priceEur || 0) + (booking.vatIncludedEur || 0);
    }, 0);
  }

  /**
   * Check if all bookings are committed
   * @returns {boolean} True if all bookings are committed
   */
  areAllBookingsCommitted() {
    return (
      this.bookings.length > 0 &&
      this.bookings.every((booking) => booking.isCommitted)
    );
  }

  /**
   * Check if all bookings are paid
   * @returns {boolean} True if all bookings are paid
   */
  areAllBookingsPaid() {
    return (
      this.bookings.length > 0 &&
      this.bookings.every((booking) => booking.isPayed)
    );
  }

  /**
   * Check if all bookings are rejected
   * @returns {boolean} True if all bookings are rejected
   */
  areAllBookingsRejected() {
    return (
      this.bookings.length > 0 &&
      this.bookings.every((booking) => booking.isRejected)
    );
  }

  /**
   * Get the earliest booking start time
   * @returns {number|null} Earliest start time or null
   */
  getEarliestStartTime() {
    if (this.bookings.length === 0) return null;
    return Math.min(...this.bookings.map((booking) => booking.timeBegin));
  }

  /**
   * Get the latest booking end time
   * @returns {number|null} Latest end time or null
   */
  getLatestEndTime() {
    if (this.bookings.length === 0) return null;
    return Math.max(...this.bookings.map((booking) => booking.timeEnd));
  }

  /**
   * Get group booking status summary
   * @returns {Object} Status summary
   */
  getStatusSummary() {
    return {
      groupBookingId: this.id,
      totalBookings: this.bookingIds.length,
      totalPrice: this.getTotalPrice(),
      allCommitted: this.areAllBookingsCommitted(),
      allPaid: this.areAllBookingsPaid(),
      allRejected: this.areAllBookingsRejected(),
      earliestStart: this.getEarliestStartTime(),
      latestEnd: this.getLatestEndTime(),
    };
  }

  /**
   * Export public group booking information
   * @returns {Object} Public group booking data
   */
  exportPublic() {
    return {
      id: this.id,
      bookingIds: this.bookingIds,
      timeCreated: this.timeCreated,
      statusSummary: this.getStatusSummary(),
    };
  }

  validate() {
    SchemaUtils.validate(this, groupBookingSchemaDefinition);

    // Additional business logic validation
    if (this.bookingIds.length === 0) {
      throw new Error("Group booking must contain at least one booking ID");
    }

    // Check for duplicate booking IDs
    const uniqueIds = new Set(this.bookingIds);
    if (uniqueIds.size !== this.bookingIds.length) {
      throw new Error("Group booking contains duplicate booking IDs");
    }

    return true;
  }

  static create(params) {
    const groupBooking = new GroupBooking(params);
    groupBooking.validate();
    return groupBooking;
  }
}

module.exports = {
  GroupBooking,
  GROUP_BOOKING_HOOK_TYPES,
};
