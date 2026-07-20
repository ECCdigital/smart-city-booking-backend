const companySchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true },
  name: { type: String, required: true },
  slug: { type: String, default: "" },
  status: {
    type: String,
    enum: ["unverified", "verified", "blocked"],
    default: "unverified",
  },
  mail: { type: String, default: "" },
  phone: { type: String, default: "" },
  website: { type: String, default: "" },
  street: { type: String, default: "" },
  postalCode: { type: String, default: "" },
  city: { type: String, default: "" },
  districtId: { type: String, default: "" },
  industryId: { type: String, default: "" },
  sizeId: { type: String, default: "" },
  logoUrl: { type: String, default: "" },
  description: { type: String, default: "" },
  location: { type: Object, default: null },
  created: { type: Number, default: () => Date.now() },
};

module.exports = companySchemaDefinition;
