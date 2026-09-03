/**
 * The deletion of a booking (spec part 1, section 8.3; part 1, 10.4): the
 * hard delete of the administration, not a lifecycle transition - a
 * deleted booking has no state to move to. It runs over the same seam as
 * the transitions: the access is taken back, the booking documents are
 * removed (a document that outlived its booking would be unreachable and
 * undeletable, nobody could grant access to it), then the booking is
 * removed from the store. Every step runs; the first that throws stops
 * the deletion, the booking stands for another attempt.
 *
 * `createBookingDeletion(adapters)` builds an instance over any adapters;
 * the default instance below runs over the production adapters.
 */

const { NotFoundError } = require("../../../errors/BaseError");

/**
 * @param {Object} adapters The seam (spec part 2, section 10)
 * @param {Object} adapters.store
 * @param {Object} adapters.access
 * @param {Object} adapters.documents
 */
function createBookingDeletion({ store, access, documents }) {
  /**
   * @param {string} tenantId
   * @param {string} bookingId
   * @returns {Promise<void>}
   * @throws {NotFoundError} `booking_not_found`
   */
  async function remove(tenantId, bookingId) {
    const booking = await store.get(tenantId, bookingId);
    if (!booking) {
      throw new NotFoundError("booking_not_found", { bookingId });
    }

    await access.revoke(tenantId, bookingId);
    await documents.remove({ tenantId, booking });
    await store.remove(tenantId, bookingId);
  }

  return { remove };
}

/** The deletion over the production adapters. */
const bookingDeletion = createBookingDeletion(require("./adapters"));

module.exports = { createBookingDeletion, bookingDeletion };
