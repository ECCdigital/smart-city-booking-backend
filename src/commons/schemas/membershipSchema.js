const membershipSchemaDefinition = {
  userId: { type: String, required: true },
  tenantId: { type: String, required: true },
  roles: { type: [String], default: [] },
  owner: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ["pending", "active", "suspended", "rejected"],
    default: "pending",
  },
  source: {
    type: String,
    enum: ["invite", "public", "manually"],
    required: true,
  },
  invitations: {
    type: [
      {
        token: { type: String, required: true },
        status: {
          type: String,
          enum: ["pending", "completed", "failed", "pending_approval"],
          default: "pending",
        },
        reason: { type: String, default: "" },
        challengeStates: {
          type: [
            {
              challengeId: { type: String, required: true },
              status: {
                type: String,
                enum: ["pending", "passed", "failed", "pending_approval"],
                default: "pending",
              },
              message: { type: String, default: "" },
              updatedAt: { type: Date, default: Date.now },
              approvedBy: { type: String, default: null },
            },
          ],
          default: [],
        },
      },
    ],
    default: [],
  },
};

module.exports = membershipSchemaDefinition;
