const GroupBookingModel = require("./models/groupBookingModel");
const { GroupBooking } = require("../entities/groupBooking/groupBooking");
const { ownCondition } = require("../services/authorization/reach");
const { REACH } = require("../services/authorization/policy");

/**
 * The condition of a reach on the group bookings (ADR 0002). Under `public` there
 * is none: what the public sees of them is the handler's projection
 * (nothing yet: no public route lists them), so the manager reads the tenant's records whole and the
 * handler shapes them - the offers alone have their projection in the
 * manager (ADR 0003).
 */
const condition = (scope) =>
  scope?.reach === REACH.PUBLIC ? {} : ownCondition("groupBooking", scope);

class GroupBookingManager {
  /**
   * Get all group bookings for a tenant
   * @param {string} tenantId Tenant ID
   * @param {{reach: string, userId?: string|null}} scope The reach the
   *   caller reads under (ADR 0002): `own` narrows to the user's own,
   *   the domain says `DOMAIN`; none is a programming error
   * @returns {Promise<GroupBooking[]>} Array of group bookings
   */
  static async getGroupBookings(tenantId, scope) {
    const rawGroupBookings = await GroupBookingModel.find({
      tenantId: tenantId,
      ...condition(scope),
    });
    return rawGroupBookings.map((doc) => doc.toEntity());
  }

  /**
   * Get a specific group booking
   * @param {string} tenantId Tenant ID
   * @param {string} groupBookingId Group booking ID
   * @param {boolean} populate Whether to populate bookings
   * @param {{reach: string, userId?: string|null}} scope The reach the
   *   caller reads under (ADR 0002): `own` narrows to the user's own,
   *   the domain says `DOMAIN`; none is a programming error
   * @returns {Promise<GroupBooking|null>} Group booking or null
   */
  static async getGroupBooking(
    tenantId,
    groupBookingId,
    populate = false,
    scope,
  ) {
    let query = GroupBookingModel.findOne({
      tenantId: tenantId,
      id: groupBookingId,
      ...condition(scope),
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
   * @param {{reach: string, userId?: string|null}} scope As of `getGroupBooking`
   * @returns {Promise<GroupBooking|null>} Populated group booking or null
   */
  static async getPopulatedGroupBooking(tenantId, groupBookingId, scope) {
    return await this.getGroupBooking(tenantId, groupBookingId, true, scope);
  }

  /**
   * Get group booking by booking ID
   * @param {string} tenantId Tenant ID
   * @param {string} bookingId Booking ID
   * @param {boolean} populate Whether to populate bookings
   * @param {{reach: string, userId?: string|null}} scope The reach the
   *   caller reads under (ADR 0002): `own` narrows to the user's own,
   *   the domain says `DOMAIN`; none is a programming error
   * @returns {Promise<GroupBooking|null>} Group booking or null
   */
  static async getGroupBookingByBookingId(
    tenantId,
    bookingId,
    populate = false,
    scope,
  ) {
    let query = GroupBookingModel.findOne({
      tenantId: tenantId,
      bookingIds: bookingId,
      ...condition(scope),
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

  static async updateGroupBooking(tenantID, gID, groupBooking) {
    if (!gID || !tenantID) {
      throw new Error("id and tenantId are required");
    }

    if (Object.keys(groupBooking).length === 0) {
      throw new Error("No fields provided for update");
    }

    const result = await GroupBookingModel.updateOne(
      { id: gID, tenantId: tenantID },
      groupBooking,
    );

    if (result.matchedCount === 0) {
      throw new Error("Group booking not found");
    }

    return await this.getGroupBooking(tenantID, gID);
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
   * @param {{reach: string, userId?: string|null}} scope The reach the
   *   caller reads under (ADR 0002); none is a programming error
   * @returns {Promise<GroupBooking[]>} Array of group bookings
   */
  static async getGroupBookingsByBookingIds(
    tenantId,
    bookingIds,
    populate = false,
    scope,
  ) {
    let query = GroupBookingModel.find({
      tenantId: tenantId,
      bookingIds: { $in: bookingIds },
      ...condition(scope),
    });

    if (populate) {
      query = query.populate("bookings");
    }

    const rawGroupBookings = await query.exec();
    return rawGroupBookings.map((doc) => doc.toEntity());
  }

  static async reassignUserReferences(
    previousUserId,
    newUserId,
    session = null,
  ) {
    const options = session ? { session } : {};

    await GroupBookingModel.updateMany(
      { assignedUserId: previousUserId },
      { $set: { assignedUserId: newUserId } },
      options,
    );

    await GroupBookingModel.updateMany(
      { mail: previousUserId },
      { $set: { mail: newUserId } },
      options,
    );
  }
}

module.exports = GroupBookingManager;
