const GroupBookingModel = require("./models/groupBookingModel");
const { GroupBooking } = require("../entities/groupBooking/groupBooking");

class GroupBookingManager {
  /**
   * Get all group bookings for a tenant
   * @param {string} tenantId Tenant ID
   * @returns {Promise<GroupBooking[]>} Array of group bookings
   */
  static async getGroupBookings(tenantId) {
    const rawGroupBookings = await GroupBookingModel.find({
      tenantId: tenantId,
    });
    return rawGroupBookings.map((doc) => doc.toEntity());
  }

  /**
   * Get a specific group booking
   * @param {string} tenantId Tenant ID
   * @param {string} groupBookingId Group booking ID
   * @param {boolean} populate Whether to populate bookings
   * @returns {Promise<GroupBooking|null>} Group booking or null
   */
  static async getGroupBooking(tenantId, groupBookingId, populate = false) {
    let query = GroupBookingModel.findOne({
      tenantId: tenantId,
      id: groupBookingId,
    });

    if (populate) {
      query = query.populate("bookings");
    }

    const rawGroupBooking = await query.exec();

    return rawGroupBooking ? rawGroupBooking.toEntity() : null;
  }

  /**
   * Get populated group booking (convenience method)
   * @param {string} tenantId Tenant ID
   * @param {string} groupBookingId Group booking ID
   * @returns {Promise<GroupBooking|null>} Populated group booking or null
   */
  static async getPopulatedGroupBooking(tenantId, groupBookingId) {
    return await this.getGroupBooking(tenantId, groupBookingId, true);
  }

  /**
   * Get group booking by booking ID
   * @param {string} tenantId Tenant ID
   * @param {string} bookingId Booking ID
   * @param {boolean} populate Whether to populate bookings
   * @returns {Promise<GroupBooking|null>} Group booking or null
   */
  static async getGroupBookingByBookingId(
    tenantId,
    bookingId,
    populate = false,
  ) {
    let query = GroupBookingModel.findOne({
      tenantId: tenantId,
      bookingIds: bookingId,
    });

    if (populate) {
      query = query.populate("bookings");
    }

    const rawGroupBooking = await query.exec();
    return rawGroupBooking ? rawGroupBooking.toEntity() : null;
  }

  /**
   * Store a group booking (create or update)
   * @param {GroupBooking|Object} groupBooking Group booking to store
   * @returns {Promise<GroupBooking>} The stored group booking
   */
  static async storeGroupBooking(groupBooking) {
    // Ensure we have a GroupBooking entity
    const groupBookingEntity =
      groupBooking instanceof GroupBooking
        ? groupBooking
        : new GroupBooking(groupBooking);

    groupBookingEntity.validate();

    await GroupBookingModel.updateOne(
      { id: groupBookingEntity.id, tenantId: groupBookingEntity.tenantId },
      groupBookingEntity,
      { upsert: true },
    );

    return groupBookingEntity;
  }

  /**
   * Delete a group booking
   * @param {string} tenantId Tenant ID
   * @param {string} groupBookingId Group booking ID
   * @returns {Promise<void>}
   */
  static async deleteGroupBooking(tenantId, groupBookingId) {
    const result = await GroupBookingModel.deleteOne({
      tenantId: tenantId,
      id: groupBookingId,
    });

    if (result.deletedCount === 0) {
      throw new Error("Group booking not found");
    }
  }

  /**
   * Add booking ID to group booking
   * @param {string} tenantId Tenant ID
   * @param {string} groupBookingId Group booking ID
   * @param {string} bookingId Booking ID to add
   * @returns {Promise<void>}
   */
  static async addBookingToGroup(tenantId, groupBookingId, bookingId) {
    await GroupBookingModel.updateOne(
      { tenantId: tenantId, id: groupBookingId },
      { $addToSet: { bookingIds: bookingId } },
    );
  }

  /**
   * Remove booking ID from group booking
   * @param {string} tenantId Tenant ID
   * @param {string} groupBookingId Group booking ID
   * @param {string} bookingId Booking ID to remove
   * @returns {Promise<void>}
   */
  static async removeBookingFromGroup(tenantId, groupBookingId, bookingId) {
    await GroupBookingModel.updateOne(
      { tenantId: tenantId, id: groupBookingId },
      { $pull: { bookingIds: bookingId } },
    );
  }

  /**
   * Get group bookings by multiple booking IDs
   * @param {string} tenantId Tenant ID
   * @param {string[]} bookingIds Array of booking IDs
   * @param {boolean} populate Whether to populate bookings
   * @returns {Promise<GroupBooking[]>} Array of group bookings
   */
  static async getGroupBookingsByBookingIds(
    tenantId,
    bookingIds,
    populate = false,
  ) {
    let query = GroupBookingModel.find({
      tenantId: tenantId,
      bookingIds: { $in: bookingIds },
    });

    if (populate) {
      query = query.populate("bookings");
    }

    const rawGroupBookings = await query.exec();
    return rawGroupBookings.map((doc) => doc.toEntity());
  }
}

module.exports = GroupBookingManager;
