module.exports = {
  name: "06-02-2025-remove-invalid-interfaces",

  up: async function (mongoose) {
    const Role = mongoose.model("Role");

    const validInterfaces = ["locations", "roles", "bookings", "coupons", "rooms", "resources", "tickets", "events"];
    const roles = await Role.find();
    for (const role of roles) {
      role.adminInterfaces = role.adminInterfaces.filter((i) => validInterfaces.includes(i));
      await role.save();
    }
  },
};