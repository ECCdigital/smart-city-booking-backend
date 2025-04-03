module.exports = {
  name: "27-03-2025-mandatory-checkout-bookables",

  up: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");
    const bookables = await Bookable.find().lean();
    for (const bookable of bookables) {
      const checkoutBookableIds =
        bookable.checkoutBookableIds?.map((id) => {
          return {
            bookableId: id,
            mandatory: false,
          };
        }) || [];
      await Bookable.collection.updateOne(
        { _id: bookable._id },
        { $set: { checkoutBookableIds: checkoutBookableIds } },
      );
    }
  },

  down: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");
    const bookables = await Bookable.find().lean();
    for (const bookable of bookables) {
      bookable.checkoutBookableIds = bookable.checkoutBookableIds.map(
        (id) => id.bookableId,
      );
      await Bookable.collection.updateOne(
        { _id: bookable._id },
        { $set: { checkoutBookableIds: bookable.checkoutBookableIds } },
      );
    }
  },
};
