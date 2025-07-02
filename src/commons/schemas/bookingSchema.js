const { Double } = require("mongodb");

const bookingHookSchemaDefinition = {
  id: { type: String, required: true },
  type: { type: String, required: true },
  timeCreated: { type: Double, default: () => Date.now() },
  payload: { type: Object, default: {} },
};

const bookingSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true, ref: "Tenant" },
  assignedUserId: { type: String, ref: "User", default: "" },
  attachments: { type: [Object], default: [] },
  bookableItems: { type: [Object], default: [] },
  comment: { type: String, default: "" },
  internalComments: { type: String, default: "" },
  rejectionReason: { type: String, default: "" },
  company: { type: String, default: "" },
  couponCode: { type: String, default: "" },
  isCommitted: { type: Boolean, default: false },
  isPayed: { type: Boolean, default: false },
  isRejected: { type: Boolean, default: false },
  location: { type: String, default: "" },
  lockerInfo: { type: [Object], default: [] },
  mail: { type: String, default: "" },
  name: { type: String, default: "" },
  paymentProvider: { type: String, default: "" },
  paymentMethod: { type: String, default: "" },
  phone: { type: String, default: "" },
  priceEur: { type: Number, default: 0 },
  street: { type: String, default: "" },
  timeBegin: { type: Double, required: false },
  timeCreated: { type: Double, default: () => Date.now() },
  timeEnd: { type: Double, required: false },
  vatIncludedEur: { type: Number, default: 0 },
  zipCode: { type: String, default: "" },
  _couponUsed: { type: Object, default: {} },
  hooks: { type: [bookingHookSchemaDefinition], default: [] },
};

module.exports = {
  bookingSchemaDefinition,
  bookingHookSchemaDefinition,
};
