module.exports = {
  name: "02-04-2025-add-price-categories",

  up: async function (mongoose) {
    const Booking = mongoose.model("Booking");
    const bookings = await Booking.find().lean();

    for (const booking of bookings) {
      if (!Array.isArray(booking.bookableItems)) continue;

      for (const bookableItem of booking.bookableItems) {
        if (bookableItem._bookableUsed) {
          const bu = bookableItem._bookableUsed;
          bu.priceCategories = [
            {
              priceEur: bu.priceEur,
              fixedPrice: false,
              interval: { start: null, end: null },
            },
          ];
          bu.priceType = bu.priceCategory;
        }
      }

      await Booking.updateOne(
        { _id: booking._id },
        { $set: { bookableItems: booking.bookableItems } },
      );
    }
  },

  down: async function (mongoose) {
    const Booking = mongoose.model("Booking");
    const bookings = await Booking.find().lean();

    for (const booking of bookings) {
      if (!Array.isArray(booking.bookableItems)) continue;

      for (const bookableItem of booking.bookableItems) {
        if (
          bookableItem._bookableUsed &&
          Array.isArray(bookableItem._bookableUsed.priceCategories)
        ) {
          const bu = bookableItem._bookableUsed;
          bu.priceEur = bu.priceCategories[0].priceEur;
          bu.priceCategory = bu.priceType;
        }
      }

      await Booking.updateOne(
        { _id: booking._id },
        { $set: { bookableItems: booking.bookableItems } },
      );
    }

    await Booking.collection.updateMany(
      {},
      {
        $unset: {
          "bookableItems.$[]._bookableUsed.priceCategories": "",
          "bookableItems.$[]._bookableUsed.priceType": "",
        },
      },
    );
  },
};
