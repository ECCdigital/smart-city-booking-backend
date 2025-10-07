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
  challenges: {
    type: [
      {
        id: { type: String, required: true },
        status: {
          type: String,
          enum: ["pending", "completed", "failed", "rejected"],
          default: "pending",
        },
        rolesToAssign: { type: [String], default: [] },
      },
    ],
    default: [],
  },
};

module.exports = membershipSchemaDefinition;
