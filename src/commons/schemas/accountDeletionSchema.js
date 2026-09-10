const accountDeletionSchemaDefinition = {
  tenantId: { type: String, required: true },
  role: { type: String, required: true },
  reasonId: { type: String, required: true },
  period: { type: String, required: true },
  count: { type: Number, default: 0 },
};

module.exports = accountDeletionSchemaDefinition;
