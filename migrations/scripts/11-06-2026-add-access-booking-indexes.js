module.exports = {
  name: "11-06-2026-add-access-booking-indexes",

  up: async function (mongoose) {
    const Booking = mongoose.model("Booking");
    const Bookable = mongoose.model("Bookable");

    // Fast lookup of a user's bookings, narrowed by time (tenant-scoped).
    await Booking.collection.createIndex(
      { tenantId: 1, assignedUserId: 1, timeBegin: 1 },
      { name: "tenant_assignedUser_timeBegin" },
    );

    // Fast lookup of a user's bookings across all tenants (tenant-independent).
    await Booking.collection.createIndex(
      { assignedUserId: 1, timeBegin: 1 },
      { name: "assignedUser_timeBegin" },
    );

    // Fast lookup of bookings referencing a (set of) bookable(s).
    await Booking.collection.createIndex(
      { tenantId: 1, "bookableItems.bookableId": 1 },
      { name: "tenant_bookableItems_bookableId" },
    );

    // Fast lookup of bookings referencing a locker process (locker access points).
    await Booking.collection.createIndex(
      { tenantId: 1, "lockerInfo.processId": 1 },
      { name: "tenant_lockerInfo_processId" },
    );

    // Fast lookup of bookables exposing an access point.
    await Bookable.collection.createIndex(
      { tenantId: 1, "accessPointDetails.points.id": 1 },
      {
        name: "tenant_accessPoint_id",
        partialFilterExpression: { "accessPointDetails.active": true },
      },
    );
  },

  down: async function (mongoose) {
    const Booking = mongoose.model("Booking");
    const Bookable = mongoose.model("Bookable");

    await Booking.collection.dropIndex("tenant_assignedUser_timeBegin");
    await Booking.collection.dropIndex("assignedUser_timeBegin");
    await Booking.collection.dropIndex("tenant_bookableItems_bookableId");
    await Booking.collection.dropIndex("tenant_lockerInfo_processId");
    await Bookable.collection.dropIndex("tenant_accessPoint_id");
  },
};
