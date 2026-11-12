/**
 * The mutex of a Schließfachanlage (`LockerSystemMutex`) excludes a second
 * holder only through the unique index on `key` of `lockersystemholds`:
 * without it, the conditional upsert of a second acquire inserts a second
 * row instead of failing. The model declares the index, but autoIndex
 * builds it in the background after the start, so a fresh collection could
 * take holds before it stands. Built here, before the instance takes
 * traffic, under the names the model gives them, so autoIndex finds them
 * there; building an index that exists already changes nothing.
 */
const COLLECTION = "lockersystemholds";

const INDEXES = [
  { keys: { key: 1 }, options: { name: "key_1", unique: true } },
  // Tidies expired holds away; an acquire ignores them anyway.
  {
    keys: { expiresAt: 1 },
    options: { name: "expiresAt_1", expireAfterSeconds: 0 },
  },
];

module.exports = {
  name: "11-11-2026-add-locker-system-hold-indexes",

  // The runner hands over the connection of the server.
  up: async function (connection) {
    const collection = connection.db.collection(COLLECTION);
    for (const { keys, options } of INDEXES) {
      await collection.createIndex(keys, options);
    }
  },

  down: async function (connection) {
    const collection = connection.db.collection(COLLECTION);
    for (const { options } of INDEXES) {
      await collection.dropIndex(options.name).catch(() => {});
    }
  },
};
