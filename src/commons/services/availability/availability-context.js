const { BookableManager } = require("../../data-managers/bookable-manager");
const BookingManager = require("../../data-managers/booking-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const EventManager = require("../../data-managers/event-manager");
const { BOOKABLE_TYPES } = require("../../entities/bookable/bookable");
const {
  isTimeRelatedBookable,
} = require("./capacity-interval-calculator");

class AvailabilityContext {
  /**
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {string} params.bookableId
   * @param {number} params.timeBegin
   * @param {number} params.timeEnd
   */
  constructor({ tenantId, bookableId, timeBegin, timeEnd }) {
    this.tenantId = tenantId;
    this.bookableId = bookableId;
    this.timeBegin = timeBegin;
    this.timeEnd = timeEnd;

    this.bookable = null;
    this.parentBookables = [];
    this.relatedBookables = [];
    this.tenant = null;
    this.bookingsByBookableId = new Map();
    this.event = null;
    this.eventBookings = null;

    this.metrics = {
      dbQueryCount: 0,
      segmentChecks: 0,
    };
  }

  /**
   * @param {string} tenantId
   * @param {string} bookableId
   * @param {number} timeBegin
   * @param {number} timeEnd
   * @returns {Promise<AvailabilityContext>}
   */
  static async create(tenantId, bookableId, timeBegin, timeEnd) {
    const context = new AvailabilityContext({
      tenantId,
      bookableId,
      timeBegin,
      timeEnd,
    });
    await context.load();
    return context;
  }

  async load() {
    const [bookable, parentBookables, relatedBookables, tenant] =
      await Promise.all([
        BookableManager.getBookable(this.bookableId, this.tenantId),
        BookableManager.getParentBookables(this.bookableId, this.tenantId),
        BookableManager.getRelatedBookables(this.bookableId, this.tenantId),
        TenantManager.getTenant(this.tenantId),
      ]);

    this.metrics.dbQueryCount += 4;
    this.bookable = bookable;
    this.parentBookables = parentBookables;
    this.relatedBookables = relatedBookables;
    this.tenant = tenant;

    const bookableIds = [
      ...new Set(
        [bookable, ...parentBookables, ...relatedBookables]
          .filter(Boolean)
          .map((b) => b.id),
      ),
    ];

    const bookings = await BookingManager.getBookingsForBookableFamily(
      this.tenantId,
      bookableIds,
      this.timeBegin,
      this.timeEnd,
    );
    this.metrics.dbQueryCount += 1;
    this.#indexBookings(bookings);

    const familyBookables = [bookable, ...parentBookables, ...relatedBookables].filter(
      Boolean,
    );
    const needsUntimedBookings = familyBookables.some(
      (familyBookable) => !isTimeRelatedBookable(familyBookable),
    );

    if (needsUntimedBookings) {
      const untimedBookings = await BookingManager.getRelatedBookingsBatch(
        this.tenantId,
        bookableIds,
      );
      this.metrics.dbQueryCount += 1;
      this.#indexBookings(untimedBookings);
    }

    if (
      bookable?.type === BOOKABLE_TYPES.TICKET &&
      bookable?.eventId
    ) {
      const [event, eventBookings] = await Promise.all([
        EventManager.getEvent(bookable.eventId, this.tenantId),
        BookingManager.getEventBookings(this.tenantId, bookable.eventId),
      ]);
      this.metrics.dbQueryCount += 2;
      this.event = event;
      this.eventBookings = eventBookings;
    }
  }

  #indexBookings(bookings) {
    for (const booking of bookings) {
      if (!Array.isArray(booking.bookableItems)) {
        continue;
      }

      for (const item of booking.bookableItems) {
        if (!item.bookableId) {
          continue;
        }

        if (!this.bookingsByBookableId.has(item.bookableId)) {
          this.bookingsByBookableId.set(item.bookableId, []);
        }

        const existing = this.bookingsByBookableId.get(item.bookableId);
        if (!existing.some((b) => b.id === booking.id)) {
          existing.push(booking);
        }
      }
    }
  }

  getBookablesToCheck() {
    return [
      this.bookable,
      ...this.parentBookables,
      ...this.relatedBookables.filter((b) => b.id !== this.bookable?.id),
    ];
  }

  /**
   * @param {string} bookableId
   * @param {number} timeBegin
   * @param {number} timeEnd
   * @param {string|null} bookingToIgnore
   * @returns {import("../../entities/booking/booking").Booking[]}
   */
  getConcurrentBookings(bookableId, timeBegin, timeEnd, bookingToIgnore = null) {
    const bookings = this.bookingsByBookableId.get(bookableId) || [];
    return BookingManager.filterConcurrentBookings(
      bookings,
      timeBegin,
      timeEnd,
      bookingToIgnore,
    );
  }

  /**
   * @param {string} bookableId
   * @returns {import("../../entities/booking/booking").Booking[]}
   */
  getRelatedBookings(bookableId) {
    return this.bookingsByBookableId.get(bookableId) || [];
  }

  recordSegmentCheck() {
    this.metrics.segmentChecks += 1;
  }
}

module.exports = { AvailabilityContext };
