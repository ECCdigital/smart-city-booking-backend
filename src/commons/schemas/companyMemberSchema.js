const companyMemberSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true },
  companyId: { type: String, required: true },
  userId: { type: String, required: true },
  isOwner: { type: Boolean, default: false },
  branchId: { type: String, default: "" },
  created: { type: Number, default: () => Date.now() },
};

module.exports = companyMemberSchemaDefinition;
