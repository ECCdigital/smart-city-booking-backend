module.exports = {
  name: "05-02-2025-rename-coupon-tenant-id",

  up: async function (mongoose) {
    const Coupon = mongoose.model("Coupon");

    await Coupon.collection.updateMany({}, { $rename: { tenant: "tenantId" } });
  },

  down: async function (mongoose) {
    const Coupon = mongoose.model("Coupon");

    await Coupon.collection.updateMany({}, { $rename: { tenantId: "tenant" } });
  },
};
