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
    enum: ["invite", "public", "manual"],
    required: true,
  },
};

module.exports = membershipSchemaDefinition;