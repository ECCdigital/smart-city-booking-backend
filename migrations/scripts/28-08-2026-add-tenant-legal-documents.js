/**
 * Backfills `tenant.legalDocuments` (spec §2.4). The tenant carries no legacy
 * legal documents, so there is nothing to convert — the field starts empty
 * everywhere it is missing.
 */
module.exports = {
  name: "28-08-2026-add-tenant-legal-documents",

  up: async function (mongoose) {
    const Tenant = mongoose.model("Tenant");

    await Tenant.updateMany(
      { legalDocuments: { $exists: false } },
      { $set: { legalDocuments: [] } },
    );
  },

  down: async function (mongoose) {
    const Tenant = mongoose.model("Tenant");

    await Tenant.updateMany({}, { $unset: { legalDocuments: "" } });
  },
};
