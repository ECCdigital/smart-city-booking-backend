const { Double } = require("mongodb");

const groupBookingHookSchemaDefinition = {
  id: { type: String, required: true },
  type: { type: String, required: true },
  timeCreated: { type: Double, default: () => Date.now() },
  payload: { type: Object, default: {} },
};

const groupBookingSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true, ref: "Tenant" },
  bookingIds: { type: [String], default: [] },
  assignedUserId: { type: String, default: "" },
  mail: { type: String, default: "" },
  timeCreated: { type: Double, default: () => Date.now() },
  hooks: { type: [groupBookingHookSchemaDefinition], default: [] },
};

module.exports = {
  groupBookingSchemaDefinition,
  groupBookingHookSchemaDefinition,
};
