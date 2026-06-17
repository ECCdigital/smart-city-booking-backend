const { BookableManager } = require("../../data-managers/bookable-manager");
const BookingManager = require("../../data-managers/booking-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const EventManager = require("../../data-managers/event-manager");
const { BOOKABLE_TYPES } = require("../../entities/bookable/bookable");
const { AvailabilityDataProvider } = require("./availability-data-provider");

/**
 * Live DB-backed provider aligned with {@link ItemCheckoutService} data access.
 */
class CheckoutDataProvider extends AvailabilityDataProvider {
  /**
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {string} params.bookableId
   * @param {number} params.timeBegin
   * @param {number} params.timeEnd
   */
  constructor({ tenantId, bookableId, timeBegin, timeEnd }) {
    super();
    this.tenantId = tenantId;
    this.bookableId = bookableId;
    this.timeBegin = timeBegin;
    this.timeEnd = timeEnd;

    this.bookable = null;
    this.parentBookables = [];
    this.relatedBookables = [];
    this.tenant = null;
    this.event = null;
    this.eventBookings = [];
  }

  /**
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {string} params.bookableId
   * @param {number} params.timeBegin
   * @param {number} params.timeEnd
   * @returns {Promise<CheckoutDataProvider>}
   */
  static async create(params) {
    const provider = new CheckoutDataProvider(params);
    await provider.load();
    return provider;
  }

  /**
   * @param {import("../../services/checkout/item-checkout-service").ItemCheckoutService} checkoutService
   * @returns {Promise<CheckoutDataProvider>}
   */
  static async fromCheckoutService(checkoutService) {
    const provider = new CheckoutDataProvider({
      tenantId: checkoutService.tenantId,
      bookableId: checkoutService.bookableId,
      timeBegin: checkoutService.timeBegin,
      timeEnd: checkoutService.timeEnd,
    });

    await provider.load({
      bookableOverride: checkoutService.originBookable,
    });

    return provider;
  }

  /**
   * @param {Object} [options]
   * @param {import("../../entities/bookable/bookable").Bookable|null} [options.bookableOverride]
   */
  async load({ bookableOverride = null } = {}) {
    const [bookable, parentBookables, relatedBookables, tenant] =
      await Promise.all([
        bookableOverride ??
          BookableManager.getBookable(this.bookableId, this.tenantId),
        BookableManager.getParentBookables(this.bookableId, this.tenantId),
        BookableManager.getRelatedBookables(this.bookableId, this.tenantId),
        TenantManager.getTenant(this.tenantId),
      ]);

    this.bookable = bookable;
    this.parentBookables = parentBookables;
    this.relatedBookables = relatedBookables;
    this.tenant = tenant;

    if (
      bookable?.type === BOOKABLE_TYPES.TICKET &&
      bookable?.eventId
    ) {
      const [event, eventBookings] = await Promise.all([
        EventManager.getEvent(bookable.eventId, this.tenantId),
        BookingManager.getEventBookings(this.tenantId, bookable.eventId),
      ]);
      this.event = event;
      this.eventBookings = eventBookings;
    }
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

  async getRelatedBookablesFor(bookableId) {
    return BookableManager.getRelatedBookables(bookableId, this.tenantId);
  }

  async getConcurrentBookings(bookableId, timeBegin, timeEnd) {
    return BookingManager.getConcurrentBookings(
      bookableId,
      this.tenantId,
      timeBegin,
      timeEnd,
    );
  }

  async getRelatedBookings(bookableId) {
    return BookingManager.getRelatedBookings(this.tenantId, bookableId);
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

module.exports = { CheckoutDataProvider };
