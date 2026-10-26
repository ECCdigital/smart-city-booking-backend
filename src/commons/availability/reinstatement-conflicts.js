const { CheckoutDataProvider } = require("./providers");
const {
  runAvailabilityCheck,
  runParentAvailabilityCheck,
  runChildBookingsCheck,
} = require("./checkout-availability-checks");
const { DOMAIN } = require("../services/authorization/reach");

/** The capacity checks whose refusal names the bookings it counted. */
const CAPACITY_CHECKS = [
  runAvailabilityCheck,
  runParentAvailabilityCheck,
  runChildBookingsCheck,
];

/**
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.bookableId
 * @param {number} params.timeBegin
 * @param {number} params.timeEnd
 * @returns {Promise<import("./providers/availability-data-provider").AvailabilityDataProvider>}
 */
function createDomainProvider({ tenantId, bookableId, timeBegin, timeEnd }) {
  return CheckoutDataProvider.create({
    tenantId,
    bookableId,
    timeBegin,
    timeEnd,
    scope: DOMAIN,
  });
}

/**
 * What a reinstatement would book twice: the positions of the booking
 * whose bookable - itself, a parent or a dependent - no longer has room in
 * the booking's period, because other bookings took it while this one was
 * cancelled or rejected. The platform's own count, as the checkout runs it,
 * without the booking itself; external providers are not asked. A bookable
 * that no longer exists has nothing to collide with.
 *
 * @param {import("../entities/booking/booking").Booking} booking
 * @param {Object} [options]
 * @param {typeof createDomainProvider} [options.createProvider]
 * @returns {Promise<Array<{
 *   bookableId: string,
 *   title: string,
 *   bookings: Array<{ id: string, timeBegin: number, timeEnd: number }>
 * }>>} One entry per position in conflict, with the bookings that hold
 *   the period; empty when the booking still fits
 */
async function findReinstatementConflicts(
  booking,
  { createProvider = createDomainProvider } = {},
) {
  const conflicts = [];

  for (const item of booking.bookableItems || []) {
    const provider = await createProvider({
      tenantId: booking.tenantId,
      bookableId: item.bookableId,
      timeBegin: booking.timeBegin,
      timeEnd: booking.timeEnd,
    });
    const originBookable = provider.getBookable();
    if (!originBookable) {
      continue;
    }

    const params = {
      provider,
      originBookable,
      amount: Number(item.amount) || 1,
      timeBegin: booking.timeBegin,
      timeEnd: booking.timeEnd,
      excludeBookingIds: [booking.id],
    };

    const bookings = new Map();
    for (const check of CAPACITY_CHECKS) {
      try {
        await check(params);
      } catch (err) {
        // A refusal of a check is data; anything else is a failure. A
        // booking without a period names no bookings to collide with.
        if (!err?.checkType) {
          throw err;
        }
        for (const concurrent of err.concurrentBookings || []) {
          bookings.set(concurrent.id, concurrent);
        }
      }
    }

    if (bookings.size > 0) {
      conflicts.push({
        bookableId: originBookable.id,
        title: originBookable.title,
        bookings: [...bookings.values()],
      });
    }
  }

  return conflicts;
}

module.exports = { findReinstatementConflicts };
