const mongoose = require("mongoose");
const companyMemberSchemaDefinition = require("../../schemas/companyMemberSchema");

const { Schema } = mongoose;

const CompanyMemberSchema = new Schema(companyMemberSchemaDefinition);

CompanyMemberSchema.index({ companyId: 1, userId: 1 }, { unique: true });
CompanyMemberSchema.index({ tenantId: 1, userId: 1 });

CompanyMemberSchema.methods.toEntity = function () {
  const CompanyMember = require("../../entities/company/companyMember");
  return new CompanyMember(this.toObject());
};

module.exports =
  mongoose.models.CompanyMember ||
  mongoose.model("CompanyMember", CompanyMemberSchema, "company_members");
