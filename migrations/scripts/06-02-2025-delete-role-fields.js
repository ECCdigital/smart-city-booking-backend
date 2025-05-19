module.exports = {
  name: "06-02-2025-delete-role-fields",

  up: async function (mongoose) {
    const Role = mongoose.model("Role");

    const possibleInterfaces = [
      "locations",
      "users",
      "roles",
      "bookings",
      "coupons",
      "rooms",
      "resources",
      "tickets",
      "events",
    ];

    const roles = await Role.find({});
    for (const role of roles) {
      const filteredInterfaces = role.adminInterfaces.filter((adIfce) =>
        possibleInterfaces.includes(adIfce),
      );
      await Role.updateOne(
        { _id: role._id },
        {
          $unset: { manageTenants: 1 },
          $set: {
            adminInterfaces: filteredInterfaces,
          },
        },
        { runValidators: false, strict: false },
      );
    }
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
        },
      },
    );
  },
};
