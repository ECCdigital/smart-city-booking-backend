const mongoose = require("mongoose");
const offerSchemaDefinition = require("../../schemas/offerSchema");

const { Schema } = mongoose;

const OfferSchema = new Schema(offerSchemaDefinition);

OfferSchema.index({ tenantId: 1, companyId: 1 });
OfferSchema.index({ tenantId: 1, status: 1 });
OfferSchema.index({ tenantId: 1, districtId: 1 });
OfferSchema.index({ tenantId: 1, industryId: 1 });
OfferSchema.index({ location: "2dsphere" });

OfferSchema.methods.toEntity = function () {
  const Offer = require("../../entities/company/offer");
  return new Offer(this.toObject());
};

module.exports =
  mongoose.models.Offer || mongoose.model("Offer", OfferSchema, "offers");
