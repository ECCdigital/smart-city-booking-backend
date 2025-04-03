const { Double } = require("mongodb");
const { Booking } = require("./booking");

class GroupBooking {
  constructor({
    id,
    tenantId,
    bookingIds,
    bookings,
    assignedUserId,
    timeCreated,
    hooks,
  }) {
    this.id = id;
    this.tenantId = tenantId;
    this.bookingIds = bookingIds;
    this.bookings = (bookings || []).map((b) => new Booking(b));
    this.assignedUserId = assignedUserId;
    this.timeCreated = timeCreated || Date.now();
    this.hooks = hooks || [];
  }

  static get schema() {
    return {
      id: {
        type: String,
        required: true,
        unique: true,
      },
      tenantId: {
        type: String,
        required: true,
        ref: "Tenant",
      },
      bookingIds: [String],
      assignedUserId: String,
      timeCreated: Double,
      hooks: [Object],
    };
  }
}

module.exports = {
  GroupBooking,
};
