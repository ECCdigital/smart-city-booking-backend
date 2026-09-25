const { BookableManager } = require("../../data-managers/bookable-manager");
const BookingManager = require("../../data-managers/booking-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const EventManager = require("../../data-managers/event-manager");
const { BOOKABLE_TYPES } = require("../../entities/bookable/bookable");
const {
  isTimeRelatedBookable,
} = require("../../availability/availability-rules/booking-amount");
const { DOMAIN } = require("../authorization/reach");

/**
 * The records an availability check reads, loaded once per request.
 *
 * The reach applies to the bookable of the route (ADR 0002): the bookable
 * and, for a ticket, its event are read with the scope the caller hands
 * in - the public's for a public route, so an offer the public cannot
 * reach is not there (ADR 0003) and the service answers
 * `bookable_not_found`. Everything the bookable depends on - its parents,
 * the related bookables, the tenant and the bookings - the domain reads
 * (`DOMAIN`): the same boundary as `CheckoutDataProvider.load`. The scope
 * is required; without one the manager throws, as everywhere.
 */
class AvailabilityContext {
  /**
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {string} params.bookableId
   * @param {number} params.timeBegin
   * @param {number} params.timeEnd
   * @param {{reach: string, userId?: string|null}} params.scope The reach
   *   the bookable and its event are read under
   */
  constructor({ tenantId, bookableId, timeBegin, timeEnd, scope }) {
    this.tenantId = tenantId;
    this.bookableId = bookableId;
    this.timeBegin = timeBegin;
    this.timeEnd = timeEnd;
    this.scope = scope;

    this.bookable = null;
    this.parentBookables = [];
    this.relatedBookables = [];
    this.relatedBookablesByParentId = new Map();
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
   * @param {{reach: string, userId?: string|null}} scope The reach of the
   *   route, or `DOMAIN`
   * @returns {Promise<AvailabilityContext>}
   */
  static async create(tenantId, bookableId, timeBegin, timeEnd, scope) {
    const context = new AvailabilityContext({
      tenantId,
      bookableId,
      timeBegin,
      timeEnd,
      scope,
    });
    await context.load();
    return context;
  }

  async load() {
    const [bookable, parentBookables, relatedBookables, tenant] =
      await Promise.all([
        BookableManager.getBookable(this.bookableId, this.tenantId, this.scope),
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
        TenantManager.getTenant(this.tenantId, DOMAIN),
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
      DOMAIN,
    );
    this.metrics.dbQueryCount += 1;
    this.#indexBookings(bookings);

    if (
      bookable?.type === BOOKABLE_TYPES.TICKET &&
      parentBookables.length > 0
    ) {
      await this.#loadTicketParentRelatedBookables(
        parentBookables,
        bookableIds,
      );
    }

    const familyBookables = [
      bookable,
      ...parentBookables,
      ...relatedBookables,
    ].filter(Boolean);
    const needsUntimedBookings = familyBookables.some(
      (familyBookable) => !isTimeRelatedBookable(familyBookable),
    );

    if (needsUntimedBookings) {
      const untimedBookings = await BookingManager.getRelatedBookingsBatch(
        this.tenantId,
        bookableIds,
        DOMAIN,
      );
      this.metrics.dbQueryCount += 1;
      this.#indexBookings(untimedBookings);
    }

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
      this.metrics.dbQueryCount += 2;
      this.event = event;
      this.eventBookings = eventBookings;
    }
  }

  async #loadTicketParentRelatedBookables(parentBookables, indexedBookableIds) {
    const knownIds = new Set(indexedBookableIds);
    const extraBookableIds = new Set();

    for (const parent of parentBookables) {
      const children = await BookableManager.getRelatedBookables(
        parent.id,
        this.tenantId,
        DOMAIN,
      );
      this.metrics.dbQueryCount += 1;
      this.relatedBookablesByParentId.set(parent.id, children);

      for (const child of children) {
        if (!knownIds.has(child.id)) {
          extraBookableIds.add(child.id);
          knownIds.add(child.id);
        }
      }
    }

    if (extraBookableIds.size === 0) {
      return;
    }

    const extraIds = [...extraBookableIds];
    const extraBookings = await BookingManager.getBookingsForBookableFamily(
      this.tenantId,
      extraIds,
      this.timeBegin,
      this.timeEnd,
      DOMAIN,
    );
    this.metrics.dbQueryCount += 1;
    this.#indexBookings(extraBookings);

    if (!isTimeRelatedBookable(this.bookable)) {
      const untimedBookings = await BookingManager.getRelatedBookingsBatch(
        this.tenantId,
        extraIds,
        DOMAIN,
      );
      this.metrics.dbQueryCount += 1;
      this.#indexBookings(untimedBookings);
    }
  }

  /**
   * @param {string} bookableId
   * @returns {import("../../entities/bookable/bookable").Bookable[]}
   */
  getRelatedBookablesFor(bookableId) {
    if (bookableId === this.bookable?.id) {
      return this.relatedBookables;
    }

    return this.relatedBookablesByParentId.get(bookableId) ?? [];
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
  getConcurrentBookings(
    bookableId,
    timeBegin,
    timeEnd,
    bookingToIgnore = null,
  ) {
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
