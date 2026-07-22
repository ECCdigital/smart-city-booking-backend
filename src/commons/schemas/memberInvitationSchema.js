const memberInvitationSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true },
  companyId: { type: String, required: true },
  token: { type: String, required: true, unique: true },
  email: { type: String, default: "" },
  firstName: { type: String, default: "" },
  lastName: { type: String, default: "" },
  phone: { type: String, default: "" },
  branchId: { type: String, default: "" },
  isOwner: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ["pending", "accepted", "revoked"],
    default: "pending",
  },
  invitedBy: { type: String, default: "" },
  expiresAt: { type: Number, default: 0 },
  created: { type: Number, default: () => Date.now() },
};

module.exports = memberInvitationSchemaDefinition;
