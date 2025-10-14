module.exports = {
  name: "13-08-2025-set-default-price-type",

  up: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");

    const bookables = await Bookable.find({ 
      $or: [
        { priceType: { $exists: false } },
        { priceType: "" }
      ]
    }).lean();

    for (const bookable of bookables) {
      await Bookable.updateOne(
        { _id: bookable._id },
        { $set: { priceType: 'per-item' } }
      );
    }

  },

  down: async function (mongoose) {
    console.log("No changes to revert");
  },
};
