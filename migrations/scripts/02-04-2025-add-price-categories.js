module.exports = {
  name: "02-04-2025-add-price-categories",

  up: async function (mongoose) {
    const Booking = mongoose.model("Booking");
    const bookings = await Booking.find().lean();
    for (const booking of bookings) {
      for (const bookableItem of booking.bookableItems) {
        bookableItem._bookableUsed.priceCategories = [
          {
            priceEur: bookableItem._bookableUsed.priceEur,
            fixedPrice: false,
            interval: {
              start: null,
              end: null,
            },
          },
        ];
        bookableItem._bookableUsed.priceType =
          bookableItem._bookableUsed.priceCategory;
      }
      await Booking.updateOne(
        { _id: booking._id },
        {
          $set: {
            bookableItems: booking.bookableItems,
          },
        },
      );
    }
  },

  down: async function (mongoose) {
    const Booking = mongoose.model("Booking");
    const bookings = await Booking.find().lean();
    for (const booking of bookings) {
      for (const bookableItem of booking.bookableItems) {
        bookableItem._bookableUsed.priceEur =
          bookableItem._bookableUsed.priceCategories[0].priceEur;
        bookableItem._bookableUsed.priceCategory =
          bookableItem._bookableUsed.priceType;
      }
      await Booking.updateOne(
        { _id: booking._id },
        {
          $set: {
            bookableItems: booking.bookableItems,
          },
        },
      );
    }
    Booking.collection.updateMany(
      {},
      { $unset: { priceCategories: 1, priceType: 1 } },
    );
  },
};
