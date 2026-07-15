/**
 * @typedef {import("../../entities/bookable/bookable").Bookable} Bookable
 * @typedef {import("../../entities/booking/booking").Booking} Booking
 * @typedef {import("../../entities/tenant/tenant").Tenant} Tenant
 * @typedef {import("../../entities/event/event").Event} Event
 */

/**
 * Uniform data access for availability rule evaluation.
 * Implementations may return values synchronously or as Promises.
 */
class AvailabilityDataProvider {
  /**
   * @returns {string|Promise<string>}
   */
  getTenantId() {
    throw new Error(
      "AvailabilityDataProvider.getTenantId() is not implemented",
    );
  }

  /**
   * @returns {Bookable|null|Promise<Bookable|null>}
   */
  getBookable() {
    throw new Error(
      "AvailabilityDataProvider.getBookable() is not implemented",
    );
  }

  /**
   * @returns {Bookable[]|Promise<Bookable[]>}
   */
  getParentBookables() {
    throw new Error(
      "AvailabilityDataProvider.getParentBookables() is not implemented",
    );
  }

  /**
   * Related bookables for the origin bookable.
   *
   * @returns {Bookable[]|Promise<Bookable[]>}
   */
  getRelatedBookables() {
    throw new Error(
      "AvailabilityDataProvider.getRelatedBookables() is not implemented",
    );
  }

  /**
   * Related bookables for an arbitrary bookable (e.g. ticket parent children).
   *
   * @param {string} bookableId
   * @returns {Bookable[]|Promise<Bookable[]>}
   */
  getRelatedBookablesFor(bookableId) {
    throw new Error(
      "AvailabilityDataProvider.getRelatedBookablesFor() is not implemented",
    );
  }

  /**
   * @param {string} bookableId
   * @param {number} timeBegin
   * @param {number} timeEnd
   * @returns {Booking[]|Promise<Booking[]>}
   */
  getConcurrentBookings(bookableId, timeBegin, timeEnd) {
    throw new Error(
      "AvailabilityDataProvider.getConcurrentBookings() is not implemented",
    );
  }

  /**
   * @param {string} bookableId
   * @returns {Booking[]|Promise<Booking[]>}
   */
  getRelatedBookings(bookableId) {
    throw new Error(
      "AvailabilityDataProvider.getRelatedBookings() is not implemented",
    );
  }

  /**
   * @returns {Tenant|null|Promise<Tenant|null>}
   */
  getTenant() {
    throw new Error("AvailabilityDataProvider.getTenant() is not implemented");
  }

  /**
   * @returns {Event|null|Promise<Event|null>}
   */
  getEvent() {
    throw new Error("AvailabilityDataProvider.getEvent() is not implemented");
  }

  /**
   * @returns {Booking[]|Promise<Booking[]>}
   */
  getEventBookings() {
    throw new Error(
      "AvailabilityDataProvider.getEventBookings() is not implemented",
    );
  }
}

module.exports = { AvailabilityDataProvider };
