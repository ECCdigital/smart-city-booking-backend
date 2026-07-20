const companyBranchSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true },
  companyId: { type: String, required: true },
  name: { type: String, default: "" },
  street: { type: String, default: "" },
  postalCode: { type: String, default: "" },
  city: { type: String, default: "" },
  districtId: { type: String, default: "" },
  location: { type: Object, default: null },
  logoUrl: { type: String, default: "" },
  created: { type: Number, default: () => Date.now() },
};

module.exports = companyBranchSchemaDefinition;
