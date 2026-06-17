module.exports = {
  name: "21-05-2026-add-bookable-cancellation-policy",

  up: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");

    await Bookable.updateMany(
      { cancellationPolicy: { $exists: false } },
      { $set: { cancellationPolicy: { userCancellable: true } } },
    );
  },

  down: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");

    await Bookable.updateMany({}, { $unset: { cancellationPolicy: "" } });
  },
};
