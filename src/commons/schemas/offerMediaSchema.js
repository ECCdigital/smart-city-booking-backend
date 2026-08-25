const offerMediaSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true },
  offerId: { type: String, required: true },
  url: { type: String, default: "" },
  fileName: { type: String, default: "" },
  type: { type: String, enum: ["image", "video"], default: "image" },
  created: { type: Number, default: () => Date.now() },
};

module.exports = offerMediaSchemaDefinition;
