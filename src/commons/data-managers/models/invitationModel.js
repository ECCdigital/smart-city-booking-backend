const mongoose = require("mongoose");
const invitationSchemaDefinition = require("../../schemas/invitationSchema");

const { Schema } = mongoose;

const InvitationSchema = new Schema(invitationSchemaDefinition, {
  timestamps: true,
});

InvitationSchema.index({ token: 1 }, { unique: true });

InvitationSchema.methods.toEntity = function () {
  const Invitation = require("../../entities/tenant/invitation");
  return new Invitation(this.toObject());
};

module.exports =
  mongoose.models.Invitation || mongoose.model("Invitation", InvitationSchema);
