/**
 * The migration that builds the indexes of the locker system holds
 * (tickets#1035): the mutex of a Schließfachanlage only excludes a second
 * holder while the unique index on `key` stands, so it must exist before
 * the instance takes traffic, not whenever the model's autoIndex gets to
 * it. Builds the unique `key` and the expiry on `expiresAt`, under the
 * names the model would give them, and runs again without harm.
 */

const { expect } = require("chai");

const migration = require("../migrations/scripts/11-11-2026-add-locker-system-hold-indexes");

/** A `lockersystemholds` collection that records the indexes built. */
function fakeConnection() {
  const state = { collection: null, built: [] };
  const collection = {
    async createIndex(keys, options) {
      state.built.push({ keys, options });
    },
  };
  return {
    state,
    connection: {
      db: {
        collection: (name) => {
          state.collection = name;
          return collection;
        },
      },
    },
  };
}

describe("migration 11-11-2026-add-locker-system-hold-indexes", function () {
  it("builds the unique key the mutex relies on and the expiry of a hold", async function () {
    const { state, connection } = fakeConnection();

    await migration.up(connection);

    expect(state.collection).to.equal("lockersystemholds");
    expect(state.built).to.deep.equal([
      { keys: { key: 1 }, options: { name: "key_1", unique: true } },
      {
        keys: { expiresAt: 1 },
        options: { name: "expiresAt_1", expireAfterSeconds: 0 },
      },
    ]);
  });

  it("is named after its file", function () {
    expect(migration.name).to.equal(
      "11-11-2026-add-locker-system-hold-indexes",
    );
  });
});
