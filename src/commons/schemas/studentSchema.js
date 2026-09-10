const studentSchemaDefinition = {
  userId: { type: String, required: true },
  tenantId: { type: String, required: true },
  birthDate: { type: String, default: "" },
  school: { type: String, default: "" },
  grade: { type: String, default: "" },
  targetGroups: { type: [String], default: [] },
  created: { type: Number, default: () => Date.now() },
  guardianEmail: { type: String, default: "" },
  guardianConsentRequiredUntil: { type: Number, default: null },
  guardianConsentAt: { type: Number, default: null },
  guardianConsentBy: { type: String, default: "" },
  guardianConsentTokenHash: { type: String, default: "" },
  guardianConsentSentAt: { type: Number, default: null },
};

module.exports = studentSchemaDefinition;
