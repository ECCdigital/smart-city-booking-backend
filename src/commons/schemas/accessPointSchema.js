// Which validation rule types exist is owned by the rules themselves, so a rule
// an administrator may save is always one this server can also evaluate.
const {
  VALIDATION_RULE_TYPES,
  isKnownValidationRuleType,
} = require("../services/access/access-validation-rules");

const AccessPointType = Object.freeze({
  LOCKER: "locker",
  DOOR: "door",
});

const AccessPointMode = Object.freeze({
  REMOTE: "remote",
  AUTHORIZATION: "authorization",
  BOTH: "both",
});

const ACCESS_POINT_TYPES = Object.values(AccessPointType);
const ACCESS_POINT_MODES = Object.values(AccessPointMode);

function oneOf(allowedValues) {
  return (value) => (allowedValues.includes(value) ? true : "enum");
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateLocation(value) {
  if (value === null || value === undefined) {
    return true;
  }
  return isPlainObject(value) ? true : "validate";
}

function validateValidationRules(value) {
  if (!Array.isArray(value)) {
    return "type_array";
  }
  const allRulesKnown = value.every(
    (rule) => isPlainObject(rule) && isKnownValidationRuleType(rule.type),
  );
  return allRulesKnown ? true : "enum";
}

/**
 * Access points are tenant-wide entities. `metadata` is deliberately absent:
 * runtime information such as provider capabilities is attached to the entity
 * on the fly and must never be persisted.
 */
const accessPointSchemaDefinition = {
  id: { type: String, required: true },
  tenantId: { type: String, required: true },
  type: {
    type: String,
    required: true,
    default: AccessPointType.DOOR,
    enum: ACCESS_POINT_TYPES,
    validate: oneOf(ACCESS_POINT_TYPES),
  },
  provider: { type: String, required: true },
  externalId: { type: String, default: "" },
  providerLocationId: { type: String, default: null },
  label: { type: String, default: "" },
  mode: {
    type: String,
    required: true,
    default: AccessPointMode.AUTHORIZATION,
    enum: ACCESS_POINT_MODES,
    validate: oneOf(ACCESS_POINT_MODES),
  },
  config: { type: Object, default: () => ({}) },
  location: { type: Object, default: null, validate: validateLocation },
  validationRules: {
    type: [Object],
    default: () => [{ type: VALIDATION_RULE_TYPES.QR_SCAN }],
    validate: validateValidationRules,
  },
  scanCode: { type: String, required: true },
  previousScanCodes: { type: [String], default: () => [] },
};

module.exports = {
  accessPointSchemaDefinition,
  AccessPointType,
  AccessPointMode,
  VALIDATION_RULE_TYPES,
};
