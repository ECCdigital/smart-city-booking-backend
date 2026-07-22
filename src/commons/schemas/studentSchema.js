const studentSchemaDefinition = {
  userId: { type: String, required: true },
  tenantId: { type: String, required: true },
  birthDate: { type: String, default: "" },
  school: { type: String, default: "" },
  grade: { type: String, default: "" },
  targetGroups: { type: [String], default: [] },
  created: { type: Number, default: () => Date.now() },
};

module.exports = studentSchemaDefinition;
