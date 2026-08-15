module.exports = {
  name: "13-07-2026-add-cancellation-contact-hint",

  up: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");
    const Booking = mongoose.model("Booking");

    await Bookable.updateMany(
      { "cancellationPolicy.contactHint": { $exists: false } },
      { $set: { "cancellationPolicy.contactHint": "" } },
    );

    await Booking.updateMany(
      { "cancellationPolicy.contactHint": { $exists: false } },
      { $set: { "cancellationPolicy.contactHint": "" } },
    );
  },

  down: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");
    const Booking = mongoose.model("Booking");

    await Bookable.updateMany(
      {},
      { $unset: { "cancellationPolicy.contactHint": "" } },
    );

    await Booking.updateMany(
      {},
      { $unset: { "cancellationPolicy.contactHint": "" } },
    );
  },
};
