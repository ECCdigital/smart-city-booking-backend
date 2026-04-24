const { Double } = require("mongodb");

const HOOK_STATUS = Object.freeze({
  ACTIVE: "active",
  RELEASED: "released",
  REVOKED: "revoked",
});

const userHookSchemaDefinition = {
  id: { type: String, required: true },
  type: { type: String, required: true },
  timeCreated: { type: Double, default: () => Date.now() },
  status: { type: String, default: "active" },
  payload: { type: Object, default: {} },
};

const userSchemaDefinition = {
  id: { type: String, required: true },
  firstName: { type: String, default: "" },
  lastName: { type: String, default: "" },
  phone: { type: String, default: "" },
  address: { type: String, default: "" },
  zipCode: { type: String, default: "" },
  city: { type: String, default: "" },
  secret: { type: String, default: "" },
  hooks: { type: [userHookSchemaDefinition], default: [] },
  isVerified: { type: Boolean, default: false },
  created: { type: Double, default: () => Date.now() },
  company: { type: String, default: "" },
  isSuspended: { type: Boolean, default: false },
  authType: { type: String, default: "local" },
  cardAuth: {
    type: Object,
    default: null,
  },
};

module.exports = {
  userSchemaDefinition,
  userHookSchemaDefinition,
};
