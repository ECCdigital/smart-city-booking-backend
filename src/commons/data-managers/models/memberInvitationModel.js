const mongoose = require("mongoose");
const memberInvitationSchemaDefinition = require("../../schemas/memberInvitationSchema");

const { Schema } = mongoose;

const MemberInvitationSchema = new Schema(memberInvitationSchemaDefinition);

MemberInvitationSchema.index({ tenantId: 1, companyId: 1 });

MemberInvitationSchema.methods.toEntity = function () {
  const MemberInvitation = require("../../entities/company/memberInvitation");
  return new MemberInvitation(this.toObject());
};

module.exports =
  mongoose.models.MemberInvitation ||
  mongoose.model(
    "MemberInvitation",
    MemberInvitationSchema,
    "member_invitations",
  );
