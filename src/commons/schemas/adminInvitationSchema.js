const adminInvitationSchemaDefinition = {
  id: { type: String, required: true },
  tenantId: { type: String, required: true },
  token: { type: String, required: true },
  email: { type: String, required: true },
  firstName: { type: String, default: "" },
  lastName: { type: String, default: "" },
  roleId: { type: String, required: true },
  status: {
    type: String,
    enum: ["pending", "accepted", "revoked"],
    default: "pending",
  },
  invitedBy: { type: String, default: "" },
  expiresAt: { type: Number, default: 0 },
  created: { type: Number, default: () => Date.now() },
};

module.exports = adminInvitationSchemaDefinition;
