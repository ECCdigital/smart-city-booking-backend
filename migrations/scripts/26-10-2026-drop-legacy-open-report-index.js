/**
 * The reports of users kept one open report per tenant and user with the
 * unique index `tenantId_1_targetUserId_1`. The reports of addresses
 * replaced it with two named partial indexes, one per target, but an index
 * once built stays in the database: a report
 * about an address has no `targetUserId`, so the old index refuses the
 * second open one of a tenant as a duplicate. The old index goes; the named
 * ones of the model stay, and are built right after: while the old index
 * stood, `open_report_per_tenant_and_user` with the same key could not be,
 * and the start does not build it again before the next one.
 */
const KEPT = "open_report_per_tenant_and_user";

const isLegacy = (index) =>
  index.name !== KEPT &&
  index.unique === true &&
  JSON.stringify(index.key) ===
    JSON.stringify({ tenantId: 1, targetUserId: 1 });

module.exports = {
  name: "26-10-2026-drop-legacy-open-report-index",

  // The runner hands over the connection of the server.
  up: async function (connection) {
    const collection = connection.db.collection("reports");
    let indexes;
    try {
      indexes = await collection.indexes();
    } catch (error) {
      // No reports yet: nothing to drop.
      if (error.codeName === "NamespaceNotFound" || error.code === 26) return;
      throw error;
    }
    for (const index of indexes.filter(isLegacy)) {
      await collection.dropIndex(index.name);
    }
    // Builds what is missing, leaves an index there already as it is.
    await connection.model("Report").createIndexes();
  },

  down: async function () {
    // Not reversible: the old index would refuse open reports of addresses.
  },
};
