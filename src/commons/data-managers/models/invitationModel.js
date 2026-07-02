const mongoose = require("mongoose");
const invitationSchemaDefinition = require("../../schemas/invitationSchema");

const { Schema } = mongoose;

const InvitationSchema = new Schema(invitationSchemaDefinition, {
  timestamps: true,
});

InvitationSchema.index({ token: 1 }, { unique: true });
InvitationSchema.index(
  { tenantId: 1, intendedUserId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: "single",
      status: "active",
      usedCount: { $lt: 1 },
      intendedUserId: { $exists: true, $ne: "" },
    },
  },
);

InvitationSchema.methods.toEntity = function () {
  const Invitation = require("../../entities/tenant/invitation");
  return new Invitation(this.toObject());
};

module.exports =
  mongoose.models.Invitation || mongoose.model("Invitation", InvitationSchema);
