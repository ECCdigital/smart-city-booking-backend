module.exports = {
  name: "03-06-2026-add-access-points",

  up: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");
    const Booking = mongoose.model("Booking");

    await Bookable.updateMany(
      { accessPointDetails: { $exists: false } },
      { $set: { accessPointDetails: { active: false, points: [] } } },
    );

    await Booking.updateMany(
      { accessInfo: { $exists: false } },
      { $set: { accessInfo: [] } },
    );

    require("../../src/commons/data-managers/models/accessLogModel");
    const AccessLog = mongoose.model("AccessLog");
    await AccessLog.createCollection();
    await AccessLog.syncIndexes();
  },

  down: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");
    const Booking = mongoose.model("Booking");

    await Bookable.updateMany({}, { $unset: { accessPointDetails: "" } });
    await Booking.updateMany({}, { $unset: { accessInfo: "" } });
  },
};
