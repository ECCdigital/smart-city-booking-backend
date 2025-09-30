const invitationSchemaDefinition = {
  tenantId: { type: String, required: true },
  token: { type: String, required: true },
  type: {
    type: String,
    enum: ["single", "multi"],
    required: true,
  },
  maxUses: { type: Number, default: null },
  usedCount: { type: Number, default: 0 },
  challenges: {
    type: [
      {
        id: { type: String, required: true },
        status: {
          type: String,
          enum: ["pending", "completed", "failed", "rejected"],
          default: "pending",
        },
      },
    ],
    default: [],
  },
  roles: { type: [String], default: [] },
  intendedUserId: { type: String, default: null },
  expiresAt: { type: Number, default: null },
  status: {
    type: String,
    enum: ["active", "revoked", "rejected"],
    default: "active",
  },
};

module.exports = invitationSchemaDefinition;
