const mongoose = require("mongoose");
const companyMediaSchemaDefinition = require("../../schemas/companyMediaSchema");

const { Schema } = mongoose;

const CompanyMediaSchema = new Schema(companyMediaSchemaDefinition);

CompanyMediaSchema.index({ tenantId: 1, companyId: 1 });

CompanyMediaSchema.methods.toEntity = function () {
  const CompanyMedia = require("../../entities/company/companyMedia");
  return new CompanyMedia(this.toObject());
};

module.exports =
  mongoose.models.CompanyMedia ||
  mongoose.model("CompanyMedia", CompanyMediaSchema, "company_media");
