const BOOKING_INDEXES = [
  {
    keys: { tenantId: 1, timeBegin: -1 },
    name: "tenantId_1_timeBegin_-1",
  },
  {
    keys: { tenantId: 1, assignedUserId: 1 },
    name: "tenantId_1_assignedUserId_1",
  },
  {
    keys: { tenantId: 1, "bookableItems.bookableId": 1 },
    name: "tenant_bookableItems_bookableId",
  },
  {
    keys: { tenantId: 1, id: 1 },
    name: "tenantId_1_id_1",
  },
];

function serializeIndexKeys(keys) {
  return JSON.stringify(keys);
}

async function ensureIndexes(collection, indexes) {
  const existing = await collection.indexes();

  for (const { keys, name } of indexes) {
    const serializedKeys = serializeIndexKeys(keys);
    const existingByKeys = existing.find(
      (index) =>
        index.name !== "_id_" &&
        serializeIndexKeys(index.key) === serializedKeys,
    );

    if (existingByKeys) {
      console.log(
        `Index on ${serializedKeys} already exists as "${existingByKeys.name}", skipping`,
      );
      continue;
    }

    await collection.createIndex(keys, { name });
    console.log(`Created index "${name}"`);
  }
}

async function dropIndexesByKeys(collection, indexes) {
  const existing = await collection.indexes();

  for (const { keys } of indexes) {
    const serializedKeys = serializeIndexKeys(keys);
    const existingByKeys = existing.find(
      (index) =>
        index.name !== "_id_" &&
        serializeIndexKeys(index.key) === serializedKeys,
    );

    if (!existingByKeys) {
      continue;
    }

    await collection.dropIndex(existingByKeys.name);
  }
}

module.exports = {
  name: "23-06-2026-add-booking-indexes",

  up: async function (mongoose) {
    const Booking = mongoose.model("Booking");
    await ensureIndexes(Booking.collection, BOOKING_INDEXES);
  },

  down: async function (mongoose) {
    const Booking = mongoose.model("Booking");
    await dropIndexesByKeys(Booking.collection, BOOKING_INDEXES);
  },
};
