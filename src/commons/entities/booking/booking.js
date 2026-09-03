const bunyan = require("bunyan");
const { bookingSchemaDefinition } = require("../../schemas/bookingSchema");
const SchemaUtils = require("../../utilities/schemaUtils");
const { BookingHook, BOOKING_HOOK_TYPES } = require("./bookingHook");
const { deriveLockerInfo } = require("./locker-info");
const {
  STATUS,
  STATUSES,
  flagsFromStatus,
  cancelledFromFlags,
  statusFromFlags,
} = require("../../services/booking-lifecycle/booking-state");

const logger = bunyan.createLogger({
  name: "booking-entity",
  level: process.env.LOG_LEVEL,
});

/** The three flags the entity derives from `status` (booking-state.js). */
const DERIVED_FLAGS = Object.freeze(["isCommitted", "isPayed", "isRejected"]);

/**
 * A write to a derived flag is a bug: the state is the source, the flags
 * follow it. Tests fail on it; production logs it and keeps the state.
 */
function rejectFlagWrite(booking, flag, value) {
  const message =
    `booking ${booking.id}: ${flag} is derived from status and cannot be ` +
    `assigned (${value}); set status instead`;

  if (process.env.NODE_ENV === "test") {
    throw new Error(message);
  }
  logger.error({ bookingId: booking.id, flag, value }, message);
}

/**
 * `status` and the three flags as own enumerable accessors: they go out
 * with the booking like any stored field, the flags read off the state.
 */
function defineStateAccessors(booking) {
  let status;

  Object.defineProperty(booking, "status", {
    get: () => status,
    set: (value) => {
      if (!STATUSES.includes(value)) {
        throw new Error(`booking-state: unknown booking status ${value}`);
      }
      status = value;
    },
    enumerable: true,
    configurable: true,
  });

  for (const flag of DERIVED_FLAGS) {
    Object.defineProperty(booking, flag, {
      get: () =>
        flagsFromStatus(
          booking.status,
          booking.priceEur,
          booking.cancellationRefund?.cancelledFrom,
        )[flag],
      set: (value) => rejectFlagWrite(booking, flag, value),
      enumerable: true,
      configurable: true,
    });
  }
}

class Booking {
  constructor(params = {}) {
    // `lockerInfo` is read off the compartments in `accessInfo` (see
    // locker-info.js) and never stored: an own accessor, so it goes out
    // with the booking like any field, while a value handed in - the
    // admin form still sends one - is dropped here.
    Object.defineProperty(this, "lockerInfo", {
      get: () => deriveLockerInfo(this.accessInfo),
      set: () => {},
      enumerable: true,
      configurable: true,
    });

    // The state comes in as `status` (a stored document, a copy) or, from a
    // document not migrated yet or a request body, as the three flags.
    const { status, isCommitted, isPayed, isRejected, ...fields } = params;

    const defaults = SchemaUtils.createDefaults(bookingSchemaDefinition);
    for (const key of ["status", ...DERIVED_FLAGS]) {
      delete defaults[key];
    }
    Object.assign(this, defaults, fields);

    defineStateAccessors(this);
    if (status == null || status === "") {
      const flags = { isCommitted, isPayed, isRejected };
      this.status = statusFromFlags(flags, this.priceEur);
      // A cancelled booking reads `isPayed` off the state it was cancelled
      // from; flags that say "cancelled" still carry it, so it is kept.
      if (
        this.status === STATUS.CANCELLED &&
        this.cancellationRefund?.cancelledFrom == null
      ) {
        this.cancellationRefund = {
          ...this.cancellationRefund,
          cancelledFrom: cancelledFromFlags(flags, this.priceEur),
        };
      }
    } else {
      this.status = status;
    }

    this.customFieldDefinitions = params.customFieldDefinitions;
    this.customFields = params.customFields;

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
   * Whether the booking is valid independent of the current time, i.e.
   * confirmed: committed, paid where priced, and not cancelled.
   * @returns {boolean} True if the booking is valid
   */
  isBookingValid() {
    return this.status === STATUS.CONFIRMED;
  }

  getIsActive() {
    if (!this.isBookingValid()) {
      return false;
    }

    const now = Date.now();
    return this.timeBegin <= now && this.timeEnd >= now;
  }

  /**
   * Whether the booking is currently within its access window, i.e. its time
   * range optionally extended by a lead time before `timeBegin` and a lag
   * time after `timeEnd`. Used to decide whether the access points linked to
   * the booking may be operated.
   * @param {number} beforeMs Lead time before timeBegin (milliseconds)
   * @param {number} afterMs Lag time after timeEnd (milliseconds)
   * @param {number} now Reference timestamp (defaults to Date.now())
   * @returns {boolean} True if within the (buffered) access window
   */
  isWithinAccessWindow(beforeMs = 0, afterMs = 0, now = Date.now()) {
    if (!this.isBookingValid()) {
      return false;
    }

    return this.timeBegin - beforeMs <= now && this.timeEnd + afterMs >= now;
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
      status: this.status,
      isCommitted: this.isCommitted,
      isPayed: this.isPayed,
      isRejected: this.isRejected,
      cancellationPolicy: this.cancellationPolicy,
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
      status: this.status,
      isCommitted: this.isCommitted,
      isPayed: this.isPayed,
      isRejected: this.isRejected,
      priceEur: this.priceEur,
      bookableItems: this.bookableItems,
      cancellationPolicy: this.cancellationPolicy,
    };
  }

  /**
   * Enrich this booking with merged checkout custom field definitions and resolved values.
   * @param {{ instanceFields: Array, tenantFields: Array, bookableFields: Array }} definitions
   * @returns {Booking} this (for chaining)
   */
  enrichCustomFields({ instanceFields, tenantFields, bookableFields = [] }) {
    const {
      CustomFieldService,
    } = require("../../services/custom-field/custom-field-service");

    const mergedDefs = CustomFieldService.mergeDefinitions({
      instanceFields,
      tenantFields,
      bookableFields,
    });

    this.customFieldDefinitions =
      CustomFieldService.filterCheckoutDefinitions(mergedDefs);

    this.customFields = CustomFieldService.resolveFieldsWithValues(
      this.customFieldDefinitions,
      this.customFieldValues || [],
    );

    return this;
  }

  validate() {
    SchemaUtils.validate(this, bookingSchemaDefinition);
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
