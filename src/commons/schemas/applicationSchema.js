const applicationSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true },
  offerId: { type: String, default: "" },
  companyId: { type: String, required: true },
  branchId: { type: String, default: "" },
  isUnsolicited: { type: Boolean, default: false },
  studentUserId: { type: String, required: true },
  firstName: { type: String, default: "" },
  lastName: { type: String, default: "" },
  email: { type: String, default: "" },
  phone: { type: String, default: "" },
  birthDate: { type: String, default: "" },
  motivation: { type: String, default: "" },
  consent: { type: Boolean, default: false },
  consentAt: { type: Number, default: null },
  status: {
    type: String,
    default: "",
  },
  documents: { type: Array, default: [] },
  created: { type: Number, default: () => Date.now() },
};

module.exports = applicationSchemaDefinition;
