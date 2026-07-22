const OfferBookmarkModel = require("./models/offerBookmarkModel");

class OfferBookmarkManager {
  static async getByUser(tenantId, userId) {
    const raw = await OfferBookmarkModel.find({ tenantId, userId }).sort({
      created: -1,
    });
    return raw.map((doc) => doc.toEntity());
  }

  static async add(tenantId, userId, offerId) {
    await OfferBookmarkModel.updateOne(
      { tenantId, userId, offerId },
      { $setOnInsert: { tenantId, userId, offerId, created: Date.now() } },
      { upsert: true },
    );
  }

  static async setNote(tenantId, userId, offerId, note) {
    await OfferBookmarkModel.updateOne(
      { tenantId, userId, offerId },
      {
        $set: { note },
        $setOnInsert: { tenantId, userId, offerId, created: Date.now() },
      },
      { upsert: true },
    );
  }

  static async remove(tenantId, userId, offerId) {
    await OfferBookmarkModel.deleteOne({ tenantId, userId, offerId });
  }

  static async removeByUser(userId) {
    await OfferBookmarkModel.deleteMany({ userId });
  }

  static async removeByOffer(tenantId, offerId) {
    await OfferBookmarkModel.deleteMany({ tenantId, offerId });
  }
}

module.exports = OfferBookmarkManager;
