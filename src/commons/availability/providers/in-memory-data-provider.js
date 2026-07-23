const BookingManager = require("../../data-managers/booking-manager");
const { AvailabilityDataProvider } = require("./availability-data-provider");

/**
 * Fixture-backed provider for tests and deterministic comparisons.
 */
class InMemoryAvailabilityDataProvider extends AvailabilityDataProvider {
  /**
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {import("../../entities/bookable/bookable").Bookable} params.bookable
   * @param {import("../../entities/bookable/bookable").Bookable[]} [params.parentBookables]
   * @param {import("../../entities/bookable/bookable").Bookable[]} [params.relatedBookables]
   * @param {Map<string, import("../../entities/bookable/bookable").Bookable[]>|Record<string, import("../../entities/bookable/bookable").Bookable[]>} [params.relatedBookablesByParentId]
   * @param {Map<string, import("../../entities/booking/booking").Booking[]>|Record<string, import("../../entities/booking/booking").Booking[]>} params.bookingsByBookableId
   * @param {import("../../entities/tenant/tenant").Tenant|null} [params.tenant]
   * @param {import("../../entities/event/event").Event|null} [params.event]
   * @param {import("../../entities/booking/booking").Booking[]} [params.eventBookings]
   */
  constructor({
    tenantId,
    bookable,
    parentBookables = [],
    relatedBookables = [],
    relatedBookablesByParentId = {},
    bookingsByBookableId,
    tenant = null,
    event = null,
    eventBookings = [],
  }) {
    super();
    this.tenantId = tenantId;
    this.bookable = bookable;
    this.parentBookables = parentBookables;
    this.relatedBookables = relatedBookables;
    this.relatedBookablesByParentId = InMemoryAvailabilityDataProvider.#toMap(
      relatedBookablesByParentId,
    );
    this.bookingsByBookableId =
      InMemoryAvailabilityDataProvider.#toMap(bookingsByBookableId);
    this.tenant = tenant;
    this.event = event;
    this.eventBookings = eventBookings;
  }

  static #toMap(value) {
    if (value instanceof Map) {
      return value;
    }

    return new Map(Object.entries(value));
  }

  getTenantId() {
    return this.tenantId;
  }

  getBookable() {
    return this.bookable;
  }

  getParentBookables() {
    return this.parentBookables;
  }

  getRelatedBookables() {
    return this.relatedBookables;
  }

  getRelatedBookablesFor(bookableId) {
    if (bookableId === this.bookable.id) {
      return this.relatedBookables;
    }

    return this.relatedBookablesByParentId.get(bookableId) ?? [];
  }

  getConcurrentBookings(bookableId, timeBegin, timeEnd) {
    const bookings = this.bookingsByBookableId.get(bookableId) ?? [];
    return BookingManager.filterConcurrentBookings(
      bookings,
      timeBegin,
      timeEnd,
    );
  }

  getRelatedBookings(bookableId) {
    return this.bookingsByBookableId.get(bookableId) ?? [];
  }

  getTenant() {
    return this.tenant;
  }

  getEvent() {
    return this.event;
  }

  getEventBookings() {
    return this.eventBookings;
  }
}

module.exports = { InMemoryAvailabilityDataProvider };
