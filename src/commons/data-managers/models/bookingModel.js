const mongoose = require("mongoose");
const { bookingSchemaDefinition } = require("../../schemas/bookingSchema");
const { Schema } = mongoose;

const BookingSchema = new Schema(bookingSchemaDefinition);

BookingSchema.pre(
  "deleteOne",
  { document: false, query: true },
  async function (next) {
    const filter = this.getFilter();
    const booking = await mongoose.models.Booking.findOne(filter);

    if (booking) {
      await mongoose.models.GroupBooking.updateMany(
        { bookingIds: booking.id },
        { $pull: { bookingIds: booking.id } },
      );
    }

    next();
  },
);

BookingSchema.methods.toEntity = function () {
  const { Booking } = require("../../entities/booking/booking");
  return new Booking(this.toObject());
};

module.exports =
  mongoose.models.Booking || mongoose.model("Booking", BookingSchema);
