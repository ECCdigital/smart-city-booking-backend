module.exports = {
  name: "02-04-2025-add-price-categories",

  up: async function (mongoose) {
    const Booking = mongoose.model("Booking");
    const bookings = await Booking.find().lean();

    for (const booking of bookings) {
      let hasChanges = false;

      for (const item of booking.bookableItems) {
        const bu = item._bookableUsed;
        if (!bu) {
          console.warn(`Skipping Booking ${booking._id}: _bookableUsed fehlt`);
          continue;
        }
        if (bu.priceEur == null) {
          console.warn(
            `Skipping Booking ${booking._id}: priceEur fehlt in _bookableUsed`,
          );
          continue;
        }

        bu.priceCategories = [
          {
            priceEur: bu.priceEur,
            fixedPrice: false,
            interval: { start: null, end: null },
          },
        ];
        bu.priceType = bu.priceCategory;
        hasChanges = true;
      }

      if (hasChanges) {
        await Booking.updateOne(
          { _id: booking._id },
          { $set: { bookableItems: booking.bookableItems } },
        );
      }
    }
  },

  down: async function (mongoose) {
    const Booking = mongoose.model("Booking");
    const bookings = await Booking.find().lean();

    for (const booking of bookings) {
      let hasChanges = false;

      for (const item of booking.bookableItems) {
        const bu = item._bookableUsed;
        if (
          !bu ||
          !Array.isArray(bu.priceCategories) ||
          bu.priceCategories.length === 0
        ) {
          continue;
        }

        bu.priceEur = bu.priceCategories[0].priceEur;
        bu.priceCategory = bu.priceType;
        hasChanges = true;
      }

      if (hasChanges) {
        await Booking.updateOne(
          { _id: booking._id },
          { $set: { bookableItems: booking.bookableItems } },
        );
      }
    }

    await Booking.collection.updateMany(
      {},
      {
        $unset: {
          "bookableItems.$[].priceCategories": 1,
          "bookableItems.$[].priceType": 1,
        },
      },
    );
  },
};
