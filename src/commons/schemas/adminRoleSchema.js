const adminRoleSchemaDefinition = {
  id: { type: String, required: true },
  tenantId: { type: String, required: true },
  name: { type: String, required: true },
  permissions: { type: [String], default: [] },
  // built-in Administrator role: all permissions, not editable/deletable
  builtin: { type: Boolean, default: false },
  created: { type: Number, default: () => Date.now() },
};

module.exports = adminRoleSchemaDefinition;
