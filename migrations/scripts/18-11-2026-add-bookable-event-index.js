/**
 * The tickets of an event are read by `{tenantId, eventId, type}`. With only
 * `{tenantId, id}` on the bookables, that query examined every bookable of
 * the tenant. The model names the index; this migration builds it on
 * existing instances, skipping an index with the same keys under any name.
 */
const BOOKABLE_INDEXES = [
  {
    keys: { tenantId: 1, eventId: 1, type: 1 },
    name: "tenantId_1_eventId_1_type_1",
  },
];

function serializeIndexKeys(keys) {
  return JSON.stringify(keys);
}

async function existingIndexes(collection) {
  try {
    return await collection.indexes();
  } catch (error) {
    // No bookables yet: no indexes; `createIndex` creates the collection.
    if (error.codeName === "NamespaceNotFound" || error.code === 26) return [];
    throw error;
  }
}

function findByKeys(existing, keys) {
  const serializedKeys = serializeIndexKeys(keys);
  return existing.find(
    (index) =>
      index.name !== "_id_" && serializeIndexKeys(index.key) === serializedKeys,
  );
}

module.exports = {
  name: "18-11-2026-add-bookable-event-index",

  up: async function (mongoose) {
    const { collection } = mongoose.model("Bookable");
    const existing = await existingIndexes(collection);

    for (const { keys, name } of BOOKABLE_INDEXES) {
      const existingByKeys = findByKeys(existing, keys);
      if (existingByKeys) {
        console.log(
          `Index on ${serializeIndexKeys(keys)} already exists as "${existingByKeys.name}", skipping`,
        );
        continue;
      }

      await collection.createIndex(keys, { name });
      console.log(`Created index "${name}"`);
    }
  },

  down: async function (mongoose) {
    const { collection } = mongoose.model("Bookable");
    const existing = await existingIndexes(collection);

    for (const { keys } of BOOKABLE_INDEXES) {
      const existingByKeys = findByKeys(existing, keys);
      if (existingByKeys) {
        await collection.dropIndex(existingByKeys.name);
      }
    }
  },
};
