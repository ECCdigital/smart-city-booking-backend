const adminUserSchemaDefinition = {
  tenantId: { type: String, required: true },
  userId: { type: String, required: true },
  roleId: { type: String, required: true },
  created: { type: Number, default: () => Date.now() },
};

module.exports = adminUserSchemaDefinition;
