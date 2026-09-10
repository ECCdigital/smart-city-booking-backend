const OfferMedia = require("../entities/company/offerMedia");
const OfferMediaModel = require("./models/offerMediaModel");

class OfferMediaManager {
  static async getMediaByOffer(tenantId, offerId) {
    const raw = await OfferMediaModel.find({ tenantId, offerId }).sort({
      created: 1,
    });
    return raw.map((doc) => doc.toEntity());
  }

  static async getMedia(tenantId, id) {
    const raw = await OfferMediaModel.findOne({ tenantId, id });
    if (!raw) {
      return null;
    }
    return raw.toEntity();
  }

  static async storeMedia(media, upsert = true) {
    const mediaEntity =
      media instanceof OfferMedia ? media : new OfferMedia(media);
    mediaEntity.validate();
    // pass a copy: Mongoose mutates the update object with $setOnInsert on upsert
    await OfferMediaModel.updateOne(
      { id: mediaEntity.id, tenantId: mediaEntity.tenantId },
      { ...mediaEntity },
      { upsert, runValidators: true },
    );
    return mediaEntity;
  }

  static async removeMedia(tenantId, id) {
    await OfferMediaModel.deleteOne({ tenantId, id });
  }

  static async removeByOffer(tenantId, offerId) {
    await OfferMediaModel.deleteMany({ tenantId, offerId });
  }
}

module.exports = OfferMediaManager;
