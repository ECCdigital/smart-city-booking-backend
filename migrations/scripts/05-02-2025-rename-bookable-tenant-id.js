module.exports = {
  name: "05-02-2025-rename-bookable-tenant-id",

  up: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");

    await Bookable.collection.updateMany(
      {},
      { $rename: { tenant: "tenantId" } },
    );
  },

  down: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");

    await Bookable.collection.updateMany(
      {},
      { $rename: { tenantId: "tenant" } },
    );
  },
};
