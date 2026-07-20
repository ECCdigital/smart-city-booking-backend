const mongoose = require("mongoose");
const companyBranchSchemaDefinition = require("../../schemas/companyBranchSchema");

const { Schema } = mongoose;

const CompanyBranchSchema = new Schema(companyBranchSchemaDefinition);

CompanyBranchSchema.index({ tenantId: 1, companyId: 1 });
CompanyBranchSchema.index({ location: "2dsphere" });

CompanyBranchSchema.methods.toEntity = function () {
  const CompanyBranch = require("../../entities/company/companyBranch");
  return new CompanyBranch(this.toObject());
};

module.exports =
  mongoose.models.CompanyBranch ||
  mongoose.model("CompanyBranch", CompanyBranchSchema, "company_branches");
