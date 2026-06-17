const { AvailabilityDataProvider } = require("./availability-data-provider");

/**
 * Wraps a preloaded {@link AvailabilityContext} for rule evaluation.
 */
class ContextDataProvider extends AvailabilityDataProvider {
  /**
   * @param {import("../../services/availability/availability-context").AvailabilityContext} context
   */
  constructor(context) {
    super();
    this.context = context;
  }

  getTenantId() {
    return this.context.tenantId;
  }

  getBookable() {
    return this.context.bookable;
  }

  getParentBookables() {
    return this.context.parentBookables;
  }

  getRelatedBookables() {
    return this.context.relatedBookables;
  }

  getRelatedBookablesFor(bookableId) {
    return this.context.getRelatedBookablesFor(bookableId);
  }

  getConcurrentBookings(bookableId, timeBegin, timeEnd) {
    return this.context.getConcurrentBookings(bookableId, timeBegin, timeEnd);
  }

  getRelatedBookings(bookableId) {
    return this.context.getRelatedBookings(bookableId);
  }

  getTenant() {
    return this.context.tenant;
  }

  getEvent() {
    return this.context.event;
  }

  getEventBookings() {
    return this.context.eventBookings ?? [];
  }
}

module.exports = { ContextDataProvider };
