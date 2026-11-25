/**
 * Takes `manageBookings.deleteOwn` from every existing role.
 *
 * The level had no effect until `booking.delete` took it as `own`, yet the
 * role editor let it be ticked, also by "all levels". Roles that carry it
 * would delete their own bookings in every state from this release on;
 * clearing it lets the right be granted again on purpose. Only roles that
 * hold it are written, so the migration can run again.
 */
module.exports = {
  name: "23-11-2026-clear-manage-bookings-delete-own",

  up: async function (mongoose) {
    const Role = mongoose.model("Role");

    await Role.updateMany(
      { "manageBookings.deleteOwn": true },
      { $set: { "manageBookings.deleteOwn": false } },
    );
  },

  // Which roles held the level is not kept: nothing to restore.
  down: async function () {},
};
