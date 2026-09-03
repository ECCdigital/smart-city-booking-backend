/**
 * The access adapter of the booking lifecycle seam: `AccessService` behind
 * the five operations the lifecycle knows (spec part 2, section 10). Only
 * `hold` aborts a transition; the others are recorded, the failure standing
 * in the access audit log the service writes.
 */

const AccessService = require("../../access/access-service");

const access = {
  /** Holds the compartments a booking books (glossary "Vormerkung"). */
  async hold(tenantId, bookingId) {
    return await AccessService.holdForBooking(tenantId, bookingId);
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
