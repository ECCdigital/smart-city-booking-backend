const mongoose = require("mongoose");
const { Booking } = require("../../entities/booking");

const { Schema } = mongoose;

const BookingSchema = new Schema(Booking.schema);

module.exports =
  mongoose.models.Booking || mongoose.model("Booking", BookingSchema);
