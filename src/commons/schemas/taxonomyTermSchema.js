const taxonomyTermSchemaDefinition = {
  id: { type: String, required: true },
  tenantId: { type: String, required: true },
  type: {
    type: String,
    enum: [
      "industry",
      "internship_type",
      "district",
      "company_size",
      "application_status",
      "deletion_reason_student",
      "deletion_reason_company",
    ],
    required: true,
  },
  name: { type: String, required: true },
  color: { type: String, default: "" },
  active: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
};

module.exports = taxonomyTermSchemaDefinition;
