const mongoose = require("mongoose");
const companySchemaDefinition = require("../../schemas/companySchema");

const { Schema } = mongoose;

const CompanySchema = new Schema(companySchemaDefinition);

CompanySchema.index({ tenantId: 1, status: 1 });
CompanySchema.index({ location: "2dsphere" });

CompanySchema.methods.toEntity = function () {
  const Company = require("../../entities/company/company");
  return new Company(this.toObject());
};

module.exports =
  mongoose.models.Company ||
  mongoose.model("Company", CompanySchema, "companies");
