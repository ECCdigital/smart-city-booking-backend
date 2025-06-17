const mongoose = require("mongoose");
const {
  groupBookingSchemaDefinition,
} = require("../../schemas/groupBookingSchema");
const { Schema } = mongoose;

const GroupBookingSchema = new Schema(groupBookingSchemaDefinition, {
  collection: "group_bookings",
  toObject: { virtuals: true },
  toJSON: { virtuals: true },
});

GroupBookingSchema.virtual("bookings", {
  ref: "Booking",
  localField: "bookingIds",
  foreignField: "id",
  justOne: false,
});

GroupBookingSchema.index({ bookingIds: 1 });
GroupBookingSchema.index({ tenantId: 1, id: 1 });

GroupBookingSchema.methods.toEntity = function () {
  const { GroupBooking } = require("../../entities/groupBooking/groupBooking");
  return new GroupBooking(this.toObject({ virtuals: true }));
};

module.exports =
  mongoose.models.GroupBooking ||
  mongoose.model("GroupBooking", GroupBookingSchema);
