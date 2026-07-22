const offerBookmarkSchemaDefinition = {
  tenantId: { type: String, required: true },
  userId: { type: String, required: true },
  offerId: { type: String, required: true },
  note: { type: String, default: "" },
  created: { type: Number, default: () => Date.now() },
};

module.exports = offerBookmarkSchemaDefinition;
