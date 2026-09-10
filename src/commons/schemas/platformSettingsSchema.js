const platformSettingsSchemaDefinition = {
  tenantId: { type: String, required: true, unique: true },
  directPublishVerified: { type: Boolean, default: false },
  defaultApplicationStatus: { type: String, default: "application_status-neu" },
  logoUrl: { type: String, default: "" },
  maxDocsPerInternship: { type: Number, default: 5, min: 0 },
  maxDocSizeMb: { type: Number, default: 10, min: 1 },
  privacyPolicyText: { type: String, default: "" },
  studentTermsText: { type: String, default: "" },
  companyTermsText: { type: String, default: "" },
  consentText: { type: String, default: "" },
  imprintText: { type: String, default: "" },
};

module.exports = platformSettingsSchemaDefinition;
