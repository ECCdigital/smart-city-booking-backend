const invitationSchemaDefinition = {
  tenantId: { type: String, required: true },
  token: { type: String, required: true },
  type: {
    type: String,
    enum: ["single", "multi"],
    required: true,
  },
  maxUses: { type: Number, required: 1, default: 1 },
  usedCount: { type: Number, default: 0 },
  roles: { type: [String], default: [] },
  intendedUserId: { type: String, default: null },
  expiresAt: { type: Number, default: null },
  revoked: { type: Boolean, default: false },
};

module.exports = invitationSchemaDefinition;
