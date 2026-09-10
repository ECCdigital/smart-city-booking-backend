const mongoose = require("mongoose");
const adminInvitationSchemaDefinition = require("../../schemas/adminInvitationSchema");

const { Schema } = mongoose;

const AdminInvitationSchema = new Schema(adminInvitationSchemaDefinition);

AdminInvitationSchema.index({ token: 1 }, { unique: true });
// at most one pending invitation per (tenant, email)
AdminInvitationSchema.index(
  { tenantId: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } },
);

AdminInvitationSchema.methods.toEntity = function () {
  const AdminInvitation = require("../../entities/admin/adminInvitation");
  return new AdminInvitation(this.toObject());
};

module.exports =
  mongoose.models.AdminInvitation ||
  mongoose.model("AdminInvitation", AdminInvitationSchema, "admin_invitations");
