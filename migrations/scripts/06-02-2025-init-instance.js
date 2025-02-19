module.exports = {
  name: "06-02-2025-init-instance",

  up: async function (mongoose) {
    const Instance = mongoose.model("Instance");

    const existingInstance = await Instance.findOne();
    if (existingInstance) {
      return;
    }

    Instance.create({});
  },
};
