const { ItemCheckoutService } = require("./item-checkout-service");
const { CheckoutPolicy } = require("./checkout-policy");
const { CHECKOUT_REASONS } = require("./checkout-reasons");
const { CheckoutError } = require("../../../errors/CheckoutError");
const { CHECK_TYPES } = require("../../availability/checkout-check-types");

/**
 * The other bookable a refusal found without room, where a booking holds
 * the position only through it: `{ parent }` for a parent check, `{ child }`
 * for a dependent's, each `{ bookableId, title }`; `{}` otherwise.
 *
 * @param {Object} refusal The thrown check error
 * @returns {{ parent?: { bookableId: string, title: string }, child?: { bookableId: string, title: string } }}
 */
function heldThrough(refusal) {
  if (refusal.checkType === CHECK_TYPES.PARENT_AVAILABILITY) {
    const parent = (refusal.parentAvailability || []).find(
      (entry) => entry.isAvailable === false,
    );
    return parent
      ? { parent: { bookableId: parent.bookableId, title: parent.title } }
      : {};
  }
  if (refusal.checkType === CHECK_TYPES.CHILD_BOOKINGS && refusal.bookableId) {
    return { child: { bookableId: refusal.bookableId, title: refusal.title } };
  }
  return {};
}

/**
 * The checkout of one position as the administration runs it: the bookable
 * read as the domain, the booking itself left out of the counts; null for a
 * bookable that no longer exists.
 *
 * @param {import("../../entities/booking/booking").Booking} booking
 * @param {{ bookableId: string, amount: number }} item
 * @returns {Promise<ItemCheckoutService|null>}
 */
async function checkoutOf(booking, item) {
  const checkout = new ItemCheckoutService(
    {
      tenantId: booking.tenantId,
      timeBegin: booking.timeBegin,
      timeEnd: booking.timeEnd,
      bookableId: item.bookableId,
      amount: Number(item.amount) || 1,
      excludeBookingIds: [booking.id],
    },
    CheckoutPolicy.ADMIN_MANUAL,
  );
  try {
    await checkout.init();
  } catch (err) {
    if (
      err instanceof CheckoutError &&
      err.reason === CHECKOUT_REASONS.BOOKABLE_NOT_FOUND
    ) {
      return null;
    }
    throw err;
  }
  return checkout;
}

/**
 * What a reinstatement would book twice: the positions of the booking
 * whose bookable - itself, a parent or a dependent - no longer has room in
 * the booking's period, because other bookings took it while this one was
 * cancelled or rejected. The checkout's own capacity checks; a refusal that
 * names no bookings (an external provider's) is no double booking here. A
 * bookable that no longer exists has nothing to collide with.
 *
 * @param {import("../../entities/booking/booking").Booking} booking
 * @returns {Promise<Array<{
 *   bookableId: string,
 *   title: string,
 *   bookings: Array<{
 *     id: string,
 *     timeBegin: number,
 *     timeEnd: number,
 *     parent?: { bookableId: string, title: string },
 *     child?: { bookableId: string, title: string }
 *   }>
 * }>>} One entry per position in conflict, with the bookings that hold
 *   the period - `parent` or `child` names the parent or dependent without
 *   room, where a booking holds the position only through it; empty when
 *   the booking still fits
 */
async function findReinstatementConflicts(booking) {
  const conflicts = [];

  for (const item of booking.bookableItems || []) {
    const checkout = await checkoutOf(booking, item);
    if (!checkout) {
      continue;
    }

    const bookings = new Map();
    for (const check of [
      () => checkout.checkAvailability(),
      () => checkout.checkParentAvailability(),
      () => checkout.checkChildBookings(),
    ]) {
      try {
        await check();
      } catch (err) {
        // A refusal of a check is data; anything else is a failure. A
        // booking without a period names no bookings to collide with.
        if (!err?.checkType) {
          throw err;
        }
        const through = heldThrough(err);
        for (const concurrent of err.concurrentBookings || []) {
          // A booking of the position itself is named without the other.
          if (!bookings.has(concurrent.id)) {
            bookings.set(concurrent.id, { ...concurrent, ...through });
          }
        }
      }
    }

    if (bookings.size > 0) {
      conflicts.push({
        bookableId: checkout.originBookable.id,
        title: checkout.originBookable.title,
        bookings: [...bookings.values()],
      });
    }
  }

  return conflicts;
}

module.exports = { findReinstatementConflicts };
