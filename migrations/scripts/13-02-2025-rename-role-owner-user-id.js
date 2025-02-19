module.exports = {
  name: "13-02-2025-rename-role-owner-user-id",

  up: async function (mongoose) {
    const Role = mongoose.model("Role");

    await Role.collection.updateMany(
      {},
      { $rename: { ownerUserId: "assignedUserId" } },
    );
  },

  down: async function (mongoose) {
    const Role = mongoose.model("Role");

    await Role.collection.updateMany(
      {},
      { $rename: { assignedUserId: "ownerUserId" } },
    );
  },
};
