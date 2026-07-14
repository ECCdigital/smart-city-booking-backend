module.exports = {
  name: "14-07-2026-migrate-booking-discounts",

  up: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");

    const cursor = Bookable.find({
      $or: [
        { freeBookingUsers: { $exists: true, $not: { $size: 0 } } },
        { freeBookingRoles: { $exists: true, $not: { $size: 0 } } },
      ],
    })
      .lean()
      .cursor();

    for await (const bookable of cursor) {
      const users = (bookable.freeBookingUsers || []).map((userId) => ({
        userId,
        discountPercent: 100,
      }));
      const roles = (bookable.freeBookingRoles || []).map((roleId) => ({
        roleId,
        discountPercent: 100,
      }));

      await Bookable.updateOne(
        { _id: bookable._id },
        {
          $set: { bookingDiscounts: { users, roles } },
          $unset: { freeBookingUsers: "", freeBookingRoles: "" },
        },
      );
    }

    await Bookable.updateMany(
      { bookingDiscounts: { $exists: false } },
      { $set: { bookingDiscounts: { users: [], roles: [] } } },
    );

    await Bookable.updateMany(
      {},
      { $unset: { freeBookingUsers: "", freeBookingRoles: "" } },
    );
  },

  down: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");

    const cursor = Bookable.find({
      $or: [
        { "bookingDiscounts.users": { $exists: true, $not: { $size: 0 } } },
        { "bookingDiscounts.roles": { $exists: true, $not: { $size: 0 } } },
      ],
    }).cursor();

    for await (const bookable of cursor) {
      const freeBookingUsers = (bookable.bookingDiscounts?.users || [])
        .filter((entry) => entry.discountPercent >= 100)
        .map((entry) => entry.userId);
      const freeBookingRoles = (bookable.bookingDiscounts?.roles || [])
        .filter((entry) => entry.discountPercent >= 100)
        .map((entry) => entry.roleId);

      await Bookable.updateOne(
        { _id: bookable._id },
        {
          $set: { freeBookingUsers, freeBookingRoles },
          $unset: { bookingDiscounts: "" },
        },
      );
    }

    await Bookable.updateMany(
      { bookingDiscounts: { $exists: true } },
      { $unset: { bookingDiscounts: "" } },
    );
  },
};
