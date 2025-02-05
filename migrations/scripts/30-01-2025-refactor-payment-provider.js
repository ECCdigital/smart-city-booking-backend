module.exports = {
  name: "30-01-2025-refactor-payment-provider",

  up: async function (mongoose) {
    const Booking = mongoose.model("Booking");

    let count = 0;


    const cursor1 = Booking.find({
      paymentMethod: { $in: ["giroCockpit", "invoice"] },
    });
    while (await cursor1.hasNext()) {
      count++;
      const booking = await cursor1.next();
      await Booking.updateOne(
        { _id: booking._id },
        {
          $set: { paymentProvider: booking.paymentMethod, paymentMethod: null },
        },
      );
    }
    return count;
  },

  down: async function (mongoose) {
    const Booking = mongoose.model("Booking");

    let count = 0;


    const cursor1 = Booking.find({
      paymentProvider: { $in: ["giroCockpit", "invoice"] },
    });
    while (await cursor1.hasNext()) {
      count++;
      const booking = await cursor1.next();
      await Booking.updateOne(
        { _id: booking._id },
        {
          $set: { paymentMethod: booking.paymentProvider, paymentProvider: null },
        },
      );
    }
    return count;
  },
};
