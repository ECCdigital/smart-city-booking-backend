const { Double } = require("mongodb");

const couponSchemaDefinition = {
  id: { type: String, required: true },
  amount: { type: Double, default: 0 },
  description: { type: String, default: "" },
  discount: { type: Double, default: 0 },
  maxAmount: { type: Double, default: null },
  tenantId: { type: String, required: true },
  type: { type: String, required: true },
  usedAmount: { type: Double, default: 0 },
  validFrom: { type: Double, default: null },
  validTo: { type: Double, default: null },
  ownerUserId: { type: String, required: true },
};

module.exports = {
  couponSchemaDefinition,
};
