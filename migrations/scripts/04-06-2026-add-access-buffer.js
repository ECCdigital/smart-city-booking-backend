module.exports = {
  name: "04-06-2026-add-access-buffer",

  up: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");

    // Add a default access buffer (no lead/lag time) to all bookables that
    // already have accessPointDetails but no accessBuffer configured yet.
    await Bookable.updateMany(
      {
        accessPointDetails: { $exists: true },
        "accessPointDetails.accessBuffer": { $exists: false },
      },
      { $set: { "accessPointDetails.accessBuffer": { before: 0, after: 0 } } },
    );
  },

  down: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");

    await Bookable.updateMany(
      { "accessPointDetails.accessBuffer": { $exists: true } },
      { $unset: { "accessPointDetails.accessBuffer": "" } },
    );
  },
};
