const mongoose = require("mongoose");
const { Booking } = require("../../entities/booking");

const { Schema } = mongoose;

const BookingSchema = new Schema(Booking.schema);

BookingSchema.pre('deleteOne', { document: false, query: true }, async function(next) {
  const filter = this.getFilter();

  const booking = await mongoose.models.Booking.findOne(filter);
  if (booking) {
    await mongoose.models.GroupBooking.updateMany(
      { bookingIds: booking.id },
      { $pull: { bookingIds: booking.id } }
    );
  }

  next();
});

module.exports =
  mongoose.models.Booking || mongoose.model("Booking", BookingSchema);
