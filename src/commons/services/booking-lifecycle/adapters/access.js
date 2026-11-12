/**
 * The access adapter of the booking lifecycle seam: `AccessService` behind
 * the operations the lifecycle knows (spec part 2, section 10). Only `hold`
 * and `allocate` abort a transition; the others are recorded, the failure
 * standing in the access audit log the service writes.
 */

const AccessService = require("../../access/access-service");

const access = {
  /** Holds the compartments a booking books (glossary "Vormerkung"). */
  async hold(tenantId, bookingId) {
    return await AccessService.holdForBooking(tenantId, bookingId);
  },

  /**
   * Keeps or gives the Fächer of a booking at the Anlagen with their own
   * list, where it holds nothing anew: `confirmed` after an Änderung and on
   * a Wiederherstellung (tickets#1042).
   */
  async allocate(tenantId, bookingId) {
    return await AccessService.allocateForBooking(tenantId, bookingId);
  },

  /**
   * Runs `work` - the save of an Änderung or a Wiederherstellung, its
   * Zuteilung and the restore - under the mutex of the Anlagen with their
   * own list the bookings are at (tickets#1042).
   */
  async exclusive(tenantId, bookings, work) {
    return await AccessService.holdLockerSystemsOf(tenantId, bookings, work);
  },

  /** Renews the holds of unpaid bookings. */
  async refreshHolds(tenantId, bookingIds) {
    return await AccessService.refreshHolds(tenantId, bookingIds);
  },

  /** Grants the access points and compartments of a booking. */
  async provision(tenantId, bookingId) {
    return await AccessService.provisionForBooking(tenantId, bookingId);
  },

  /** Moves the grants of a booking to what it books now. */
  async update(tenantId, oldBooking, newBooking) {
    return await AccessService.updateForBooking(
      tenantId,
      oldBooking,
      newBooking,
    );
  },

  /** Takes the grants and holds of a booking back. */
  async revoke(tenantId, bookingId) {
    return await AccessService.revokeForBooking(tenantId, bookingId);
  },
};

module.exports = access;
