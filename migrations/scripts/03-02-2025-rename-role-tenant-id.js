module.exports = {
  name: "03-02-2025-rename-role-tenant-id",

  up: async function (mongoose) {
    const Role = mongoose.model("Role");

    await Role.collection.updateMany(
      {},
      { $rename: { tenant: "tenantId" } },
    );
  },

  down: async function (mongoose) {
    const Role = mongoose.model("Role");

    await Role.collection.updateMany(
      {},
      { $rename: { tenantId: "tenant" } },
    );
  },
};
