const mongoose = require("mongoose");
const offerBookmarkSchemaDefinition = require("../../schemas/offerBookmarkSchema");

const { Schema } = mongoose;

const OfferBookmarkSchema = new Schema(offerBookmarkSchemaDefinition);

OfferBookmarkSchema.index(
  { tenantId: 1, userId: 1, offerId: 1 },
  { unique: true },
);
OfferBookmarkSchema.index({ tenantId: 1, userId: 1 });

OfferBookmarkSchema.methods.toEntity = function () {
  const OfferBookmark = require("../../entities/student/offerBookmark");
  return new OfferBookmark(this.toObject());
};

module.exports =
  mongoose.models.OfferBookmark ||
  mongoose.model("OfferBookmark", OfferBookmarkSchema, "offer_bookmarks");
