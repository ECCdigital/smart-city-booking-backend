const mongoose = require("mongoose");
const membershipSchemaDefinition = require("../../schemas/membershipSchema");

const { Schema } = mongoose;

const MembershipSchema = new Schema(membershipSchemaDefinition, {
  timestamps: true,
});

MembershipSchema.index({ userId: 1, tenantId: 1 }, { unique: true });
MembershipSchema.index(
  { tenantId: 1, status: 1 },
  { name: "tenantId_1_status_1" },
);

MembershipSchema.methods.toEntity = function () {
  const Membership = require("../../entities/tenant/membership");
  return new Membership(this.toObject());
};

module.exports =
  mongoose.models.Membership || mongoose.model("Membership", MembershipSchema);
