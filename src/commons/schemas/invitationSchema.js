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
  roleAssignments: {
    type: [
      {
        role: { type: String, required: true },
        challenges: {
          type: [
            {
              key: { type: String, required: true },
              config: { type: Object, default: {} },
              status: {
                type: String,
                enum: ["pending", "passed", "failed"],
                default: "pending",
              },
            },
          ],
          default: [],
        },
      },
    ],
    default: [],
  },
  intendedUserId: { type: String, default: null },
  expiresAt: { type: Number, default: null },
  status: {
    type: String,
    enum: ["active", "revoked", "rejected"],
    default: "active",
  },
};

module.exports = invitationSchemaDefinition;
