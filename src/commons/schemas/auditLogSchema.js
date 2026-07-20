const auditLogSchemaDefinition = {
  tenantId: { type: String, required: true },
  action: { type: String, required: true },
  message: { type: String, required: true },
  // Who performed the action (resolved at write time from the request context).
  actorId: { type: String, default: "" },
  actorName: { type: String, default: "" },
  createdAt: { type: Number, default: () => Date.now() },
};

module.exports = auditLogSchemaDefinition;
