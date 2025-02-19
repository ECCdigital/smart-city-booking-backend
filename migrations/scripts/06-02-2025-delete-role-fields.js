module.exports = {
  name: "06-02-2025-delete-role-fields",

  up: async function (mongoose) {
    const Role = mongoose.model("Role");

    await Role.updateMany(
      {},
      { $unset: { manageTenants: 1, manageUsers: 1 } },
      { runValidators: false, strict: false },
    );
  },

  down: async function (mongoose) {
    const Role = mongoose.model("Role");

    await Role.updateMany(
      {},
      {
        $set: {
          manageTenants: {
            create: false,
            readAny: false,
            readOwn: false,
            updateAny: false,
            updateOwn: false,
            deleteOwn: false,
            deleteAny: false,
          },
          manageUsers: {
            create: false,
            readAny: false,
            readOwn: false,
            updateAny: false,
            updateOwn: false,
            deleteOwn: false,
            deleteAny: false,
          },
        },
      },
    );
  },
};
