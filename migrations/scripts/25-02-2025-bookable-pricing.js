module.exports = {
  name: "25-02-2025-bookable-pricing",

  up: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");
    const bookables = await Bookable.find().lean();
    for (const bookable of bookables) {
      bookable.priceCategories = [
        {
          priceEur: bookable.priceEur,
          fixedPrice: false,
          interval: {
            start: null,
            end: null,
          },
        },
      ];
      bookable.priceType = bookable.priceCategory;
      await Bookable.updateOne({ _id: bookable._id }, bookable);
    }
    Bookable.collection.updateMany(
      {},
      { $unset: { priceEur: 1, priceCategory: 1 } },
    );
  },

  down: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");
    const bookables = await Bookable.find().lean();
    for (const bookable of bookables) {
      bookable.priceEur = bookable.priceCategories[0].priceEur;
      bookable.priceCategory = bookable.priceType;

      await Bookable.updateOne({ _id: bookable._id }, bookable);
    }
    Bookable.collection.updateMany(
      {},
      { $unset: { priceCategories: 1, priceType: 1 } },
    );
  },
};
