module.exports = {
  name: "18-02-2025-merge-users",

  up: async function (mongoose) {
    const User = mongoose.model("User");
    const users = await User.find({}).sort({ id: 1, isVerified: -1 }).lean();
    const usersMap = {};
    users.forEach((user) => {
      if (!usersMap[user.id]) {
        usersMap[user.id] = user;
      }
    });

    const usersToDelete = users.filter(
      (user) => user._id.toString() !== usersMap[user.id]._id.toString(),
    );

    for (const user of usersToDelete) {
      await User.deleteOne({ _id: user._id });
    }

    await User.collection.updateMany({}, { $unset: { tenant: "", roles: "" } });
  },
};
