module.exports = {
  name: "05-02-2025-rename-event-tenant-id",

  up: async function (mongoose) {
    const Event = mongoose.model("Event");

    await Event.collection.updateMany({}, { $rename: { tenant: "tenantId" } });
  },

  down: async function (mongoose) {
    const Event = mongoose.model("Event");

    await Event.collection.updateMany({}, { $rename: { tenantId: "tenant" } });
  },
};
