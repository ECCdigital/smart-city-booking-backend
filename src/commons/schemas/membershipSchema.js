const membershipSchemaDefinition = {
  userId: { type: String, required: true },
  tenantId: { type: String, required: true },
  roleStatuses: {
    type: [
      {
        role: { type: String, required: true },
        status: {
          type: String,
          enum: ["pending", "active", "rejected", "suspended"],
          default: "pending",
        },
        source: {
          type: String,
          enum: ["invite", "manually", "keycloak"],
          default: "manually",
        },
      },
    ],
    default: [],
  },
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
};

module.exports = membershipSchemaDefinition;
