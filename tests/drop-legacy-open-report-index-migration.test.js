/**
 * The migration that drops the unique index of one open report per tenant
 * and user, which refused a second open report about an address of a
 * tenant: it drops that index alone, leaves the named indexes of the model,
 * and runs again or on a database without reports without harm.
 */

const { expect } = require("chai");

const migration = require("../migrations/scripts/26-10-2026-drop-legacy-open-report-index");

const LEGACY = {
  name: "tenantId_1_targetUserId_1",
  key: { tenantId: 1, targetUserId: 1 },
  unique: true,
  partialFilterExpression: { status: "open" },
};
const NAMED_USER = {
  name: "open_report_per_tenant_and_user",
  key: { tenantId: 1, targetUserId: 1 },
  unique: true,
};
const NAMED_ADDRESS = {
  name: "open_report_per_tenant_and_address",
  key: { tenantId: 1, targetAddress: 1 },
  unique: true,
};
const BY_STATUS = { name: "status_1_targetUserId_1", key: { status: 1 } };

/** A `reports` collection with these indexes, or none at all. */
function fakeConnection(indexes) {
  const state = { indexes: indexes && [...indexes], dropped: [] };
  const collection = {
    async indexes() {
      if (!state.indexes) {
        const error = new Error("ns does not exist");
        error.code = 26;
        error.codeName = "NamespaceNotFound";
        throw error;
      }
      return state.indexes;
    },
    async dropIndex(name) {
      state.dropped.push(name);
      state.indexes = state.indexes.filter((index) => index.name !== name);
    },
  };
  return { state, connection: { db: { collection: () => collection } } };
}

describe("migration 26-10-2026-drop-legacy-open-report-index", function () {
  it("drops the old index of one open report per tenant and user alone", async function () {
    const { state, connection } = fakeConnection([
      LEGACY,
      NAMED_USER,
      NAMED_ADDRESS,
      BY_STATUS,
    ]);

    await migration.up(connection);

    expect(state.dropped).to.deep.equal([LEGACY.name]);
    expect(state.indexes.map((index) => index.name)).to.deep.equal([
      NAMED_USER.name,
      NAMED_ADDRESS.name,
      BY_STATUS.name,
    ]);
  });

  it("drops nothing on a second run", async function () {
    const { state, connection } = fakeConnection([LEGACY, NAMED_USER]);

    await migration.up(connection);
    await migration.up(connection);

    expect(state.dropped).to.deep.equal([LEGACY.name]);
  });

  it("runs on a database without reports", async function () {
    const { state, connection } = fakeConnection(null);

    await migration.up(connection);

    expect(state.dropped).to.deep.equal([]);
  });
});
