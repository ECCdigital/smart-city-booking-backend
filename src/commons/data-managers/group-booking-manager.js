const GroupBookingModel = require("../data-managers/models/groupBookingModel");
const { GroupBooking } = require("../entities/groupBooking");

class GroupBookingManager {
  static async getGroupBookings(tenantId) {
    const rawGroupBookings = await GroupBookingModel.find({
      tenantId: tenantId,
    });
    return rawGroupBookings.map((rgb) => new GroupBooking(rgb));
  }

  static async getGroupBooking(tenantId, groupBookingId, populate = false) {
    let query = GroupBookingModel.findOne({
      tenantId: tenantId,
      id: groupBookingId,
    });

    if (populate) {
      query = query.populate("bookings");
    }
    const rawGroupBooking = await query.exec();

    return rawGroupBooking ? new GroupBooking(rawGroupBooking) : null;
  }

  static async getPopulatedGroupBooking(tenantId, groupBookingId) {
    const groupBooking = await GroupBookingModel.findOne({
      id: groupBookingId,
      tenantId: tenantId,
    })
      .populate("bookings")
      .exec();

    return new GroupBooking(groupBooking);
  }

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

    return rawGroupBooking ? new GroupBooking(rawGroupBooking) : null;
  }


  /**
   *
   * @param groupBooking
   * @returns {Promise<void>}
   */
  static async storeGroupBooking(groupBooking) {
    await GroupBookingModel.updateOne(
      { id: groupBooking.id, tenantId: groupBooking.tenantId },
      groupBooking,
      {
        upsert: true,
      },
    );
  }

  static async deleteGroupBooking(tenantId, groupBookingId) {
    const groupBooking = await GroupBookingModel.deleteOne({
      tenantId: tenantId,
      id: groupBookingId,
    });

    if (!groupBooking) {
      throw new Error("Group booking not found");
    }
  }
}

module.exports = GroupBookingManager;
