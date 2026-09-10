const mongoose = require("mongoose");
const offerMediaSchemaDefinition = require("../../schemas/offerMediaSchema");

const { Schema } = mongoose;

const OfferMediaSchema = new Schema(offerMediaSchemaDefinition);

OfferMediaSchema.index({ tenantId: 1, offerId: 1 });

OfferMediaSchema.methods.toEntity = function () {
  const OfferMedia = require("../../entities/company/offerMedia");
  return new OfferMedia(this.toObject());
};

module.exports =
  mongoose.models.OfferMedia ||
  mongoose.model("OfferMedia", OfferMediaSchema, "offer_media");
