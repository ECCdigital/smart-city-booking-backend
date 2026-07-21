module.exports = {
  name: "21-07-2026-application-offer-optional-partial-index",

  up: async function (mongoose) {
    const collection = mongoose.connection.collection("applications");
    // The unique index applies only to real offers; applications with an empty
    // offerId are exempt.
    try {
      await collection.dropIndex("tenantId_1_offerId_1_studentUserId_1");
    } catch (err) {
      if (err.codeName !== "IndexNotFound" && err.code !== 27) {
        throw err;
      }
    }
    await collection.createIndex(
      { tenantId: 1, offerId: 1, studentUserId: 1 },
      {
        unique: true,
        partialFilterExpression: { offerId: { $gt: "" } },
        name: "app_offer_unique_partial",
      },
    );
  },

  down: async function (mongoose) {
    const collection = mongoose.connection.collection("applications");
    try {
      await collection.dropIndex("app_offer_unique_partial");
    } catch (err) {
      if (err.codeName !== "IndexNotFound" && err.code !== 27) {
        throw err;
      }
    }
    await collection.createIndex(
      { tenantId: 1, offerId: 1, studentUserId: 1 },
      { unique: true, name: "tenantId_1_offerId_1_studentUserId_1" },
    );
  },
};
