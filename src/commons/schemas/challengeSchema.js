const challengeSchemaDefinition = {
  id: { type: String, required: true, index: true },
  tenantId: { type: String, required: true, index: true },
  key: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  defaultConfig: { type: Object, default: {} },
  label: { type: String, default: "" },
  description: { type: String, default: "" },
  rolesToAssign: { type: [String], default: [] },
};

module.exports = challengeSchemaDefinition;
