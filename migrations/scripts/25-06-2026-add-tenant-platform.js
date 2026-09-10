module.exports = {
  name: "25-06-2026-add-tenant-platform",

  up: async function (mongoose) {
    const Tenant = mongoose.model("Tenant");
    await Tenant.updateMany(
      { platform: { $exists: false } },
      { $set: { platform: "" } },
    );
  },

  down: async function (mongoose) {
    const Tenant = mongoose.model("Tenant");
    await Tenant.updateMany({}, { $unset: { platform: "" } });
  },
};
