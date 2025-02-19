module.exports = {
  name: "30-01-2025-refactor-payment-provider",

  up: async function (mongoose) {
    const Booking = mongoose.model("Booking");

    const bookings = await Booking.find({
      paymentMethod: { $in: ["giroCockpit", "invoice"] },
    });
    for (const booking of bookings) {
      await Booking.updateOne(
        { _id: booking._id },
        {
          $set: { paymentProvider: booking.paymentMethod, paymentMethod: null },
        },
      );
    }
  },

  down: async function (mongoose) {
    const Booking = mongoose.model("Booking");

    const bookings = await Booking.find({
      paymentProvider: { $in: ["giroCockpit", "invoice"] },
    });

    for (const booking of bookings) {
      await Booking.updateOne(
        { _id: booking._id },
        {
          $set: {
            paymentMethod: booking.paymentProvider,
            paymentProvider: null,
          },
        },
      );
    }
  },
};
