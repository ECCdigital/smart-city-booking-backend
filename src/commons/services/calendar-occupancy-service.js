const {
  BookableManager,
} = require("../data-managers/bookable-manager");
const BookingManager = require("../data-managers/booking-manager");

/**
 * Resolves the bookable family (self + transitive relatedBookableIds) in memory.
 * Mirrors BookableManager.getRelatedBookables graphLookup without per-bookable DB calls.
 *
 * @param {string} bookableId
 * @param {Map<string, import("../entities/bookable/bookable").Bookable>} bookableById
 * @returns {string[]}
 */
function resolveFamilyBookableIds(bookableId, bookableById) {
  const familyIds = new Set([bookableId]);
  const queue = [bookableId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const current = bookableById.get(currentId);
    if (!current?.relatedBookableIds?.length) {
      continue;
    }

    for (const relatedId of current.relatedBookableIds) {
      if (!bookableById.has(relatedId) || familyIds.has(relatedId)) {
        continue;
      }
      familyIds.add(relatedId);
      queue.push(relatedId);
    }
  }

  return [...familyIds];
}

/**
 * Batch calendar occupancy for tenant bookables.
 * Uses two DB round-trips (bookables + bookings) instead of O(n) per bookable.
 */
class CalendarOccupancyService {
  /**
   * @param {string} tenantId
   * @param {Object} [options]
   * @param {string[]} [options.bookableIds]
   * @param {number} [options.timeBegin]
   * @param {number} [options.timeEnd]
   * @returns {Promise<Array<{ bookableId: string, title: string, timeBegin: number, timeEnd: number }>>}
   */
  static async getOccupancies(
    tenantId,
    { bookableIds = [], timeBegin, timeEnd } = {},
  ) {
    const allBookables = await BookableManager.getBookables(tenantId);
    const bookableById = new Map(allBookables.map((bookable) => [bookable.id, bookable]));

    let targetBookables = allBookables;
    if (bookableIds.length > 0) {
      const requestedIds = new Set(bookableIds);
      targetBookables = allBookables.filter((bookable) =>
        requestedIds.has(bookable.id),
      );
    }

    const familyIdsByBookableId = new Map();
    const allFamilyIds = new Set();

    for (const bookable of targetBookables) {
      const familyIds = resolveFamilyBookableIds(bookable.id, bookableById);
      familyIdsByBookableId.set(bookable.id, familyIds);
      for (const familyId of familyIds) {
        allFamilyIds.add(familyId);
      }
    }

    const bookings = await CalendarOccupancyService.#loadBookings(
      tenantId,
      [...allFamilyIds],
      timeBegin,
      timeEnd,
    );

    const bookingsByBookableId = CalendarOccupancyService.#indexBookingsByBookableId(
      bookings,
    );

    const occupancies = [];
    for (const bookable of targetBookables) {
      const familyIds = familyIdsByBookableId.get(bookable.id) ?? [bookable.id];
      const seenBookingIds = new Set();

      for (const familyId of familyIds) {
        const familyBookings = bookingsByBookableId.get(familyId) ?? [];
        for (const booking of familyBookings) {
          if (seenBookingIds.has(booking.id)) {
            continue;
          }
          seenBookingIds.add(booking.id);
          occupancies.push({
            bookableId: bookable.id,
            title: bookable.title,
            timeBegin: booking.timeBegin,
            timeEnd: booking.timeEnd,
          });
        }
      }
    }

    return occupancies;
  }

  static async #loadBookings(tenantId, bookableIds, timeBegin, timeEnd) {
    if (!bookableIds.length) {
      return [];
    }

    if (timeBegin != null && timeEnd != null) {
      return BookingManager.getBookingsForBookableFamily(
        tenantId,
        bookableIds,
        timeBegin,
        timeEnd,
      );
    }

    const bookings = await BookingManager.getRelatedBookingsBatch(
      tenantId,
      bookableIds,
    );

    return bookings.filter(
      (booking) =>
        !!booking.timeBegin && !!booking.timeEnd && !booking.isRejected,
    );
  }

  static #indexBookingsByBookableId(bookings) {
    const bookingsByBookableId = new Map();

    for (const booking of bookings) {
      if (!booking.timeBegin || !booking.timeEnd || booking.isRejected) {
        continue;
      }

      for (const item of booking.bookableItems ?? []) {
        if (!item.bookableId) {
          continue;
        }

        if (!bookingsByBookableId.has(item.bookableId)) {
          bookingsByBookableId.set(item.bookableId, []);
        }

        const existing = bookingsByBookableId.get(item.bookableId);
        if (!existing.some((entry) => entry.id === booking.id)) {
          existing.push(booking);
        }
      }
    }

    return bookingsByBookableId;
  }
}

module.exports = CalendarOccupancyService;
