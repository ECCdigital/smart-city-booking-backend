const mongoose = require("mongoose");
const { GroupBooking } = require("../../entities/groupBooking");

const { Schema } = mongoose;

const GroupBookingSchema = new Schema(GroupBooking.schema, {
  collection: "group_bookings",
});

GroupBookingSchema.virtual("bookings", {
  ref: "Booking",
  localField: "bookingIds",
  foreignField: "id",
  justOne: false,
});

GroupBookingSchema.index({ bookingIds: 1 });

module.exports =
  mongoose.models.GroupBooking ||
  mongoose.model("GroupBooking", GroupBookingSchema);
