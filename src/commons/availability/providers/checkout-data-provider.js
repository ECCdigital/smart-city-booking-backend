const { BookableManager } = require("../../data-managers/bookable-manager");
const BookingManager = require("../../data-managers/booking-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const EventManager = require("../../data-managers/event-manager");
const { BOOKABLE_TYPES } = require("../../entities/bookable/bookable");
const { AvailabilityDataProvider } = require("./availability-data-provider");
const { DOMAIN } = require("../../services/authorization/reach");

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
   * @param {{reach: string, userId?: string|null}} [params.scope] The
   *   reach the bookable and its event are read under: the checkout's
   *   (the public's for a self-booking, ADR 0003), the domain's without one
   */
  constructor({ tenantId, bookableId, timeBegin, timeEnd, scope = DOMAIN }) {
    super();
    this.tenantId = tenantId;
    this.bookableId = bookableId;
    this.timeBegin = timeBegin;
    this.timeEnd = timeEnd;
    this.scope = scope;

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
      scope: checkoutService.scope,
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
          BookableManager.getBookable(
            this.bookableId,
            this.tenantId,
            this.scope,
          ),
        BookableManager.getAncestorBookables(
          this.bookableId,
          this.tenantId,
          DOMAIN,
        ),
        BookableManager.getRelatedBookables(
          this.bookableId,
          this.tenantId,
          DOMAIN,
        ),
        TenantManager.getTenant(this.tenantId),
      ]);

    this.bookable = bookable;
    this.parentBookables = parentBookables;
    this.relatedBookables = relatedBookables;
    this.tenant = tenant;

    if (bookable?.type === BOOKABLE_TYPES.TICKET && bookable?.eventId) {
      const [event, eventBookings] = await Promise.all([
        // The event of the ticket within the same reach: what the public
        // reaches, or the bookable would not have been.
        EventManager.getEvent(bookable.eventId, this.tenantId, this.scope),
        BookingManager.getEventBookings(
          this.tenantId,
          bookable.eventId,
          DOMAIN,
        ),
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
    return BookableManager.getRelatedBookables(
      bookableId,
      this.tenantId,
      DOMAIN,
    );
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
    return BookingManager.getRelatedBookings(this.tenantId, bookableId, DOMAIN);
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
