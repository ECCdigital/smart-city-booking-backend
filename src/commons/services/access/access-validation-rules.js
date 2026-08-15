/**
 * The evidence requirements an access point can be configured with. This module
 * is the single authority on which rule types exist: it holds their names, their
 * preconditions and how they read evidence, and both the access point schema
 * (may this type be saved?) and the evidence evaluation (what does this type
 * demand?) ask it. A rule type can therefore never be storable but
 * unimplemented, or implemented but unstorable.
 *
 * Deliberately dependency-free so the schema can rely on it.
 */

const VALIDATION_RULE_TYPES = Object.freeze({
  QR_SCAN: "qrScan",
});

const rules = new Map();

/**
 * Register a validation rule type. A rule declares three things and nothing
 * more: what it is called, which access point fields it needs to be usable at
 * all, and how it reads the evidence a client sent.
 *
 * Adding a method (e.g. a geo fence) means registering a rule here - the
 * framework around it stays as it is.
 *
 * @param {Object} rule The rule to register
 * @param {string} rule.type Rule type, as configured in `validationRules`
 * @param {string[]} [rule.requires=[]] Access point fields the rule needs to be
 *   configured. Enforced by the management API before a rule can be saved and
 *   again at open time, where an unmet precondition fails closed.
 * @param {function(Object, Object): boolean} rule.verify Decides whether a
 *   piece of evidence satisfies the rule for a given access point
 * @returns {Object} The registered rule
 */
function registerValidationRule({ type, requires = [], verify }) {
  const rule = Object.freeze({
    type,
    requires: Object.freeze(requires),
    verify,
  });
  rules.set(type, rule);
  return rule;
}

/**
 * Look up the implementation of a rule type.
 *
 * @param {string} type Rule type
 * @returns {Object|null} The rule, or null if this server does not implement it
 */
function getValidationRule(type) {
  return rules.get(type) || null;
}

/**
 * Whether a rule type may appear in an access point's `validationRules`.
 *
 * @param {string} type Rule type
 * @returns {boolean} True if a rule of that type is implemented here
 */
function isKnownValidationRuleType(type) {
  return rules.has(type);
}

registerValidationRule({
  type: VALIDATION_RULE_TYPES.QR_SCAN,
  requires: [],
  /**
   * A scan proves presence only if the code is the one currently on the door.
   * Codes that were rotated out are exactly the ones that must stop working -
   * rotation is the revocation mechanism, so there is no TTL and no nonce to
   * check besides the comparison.
   */
  verify: (evidence, accessPoint) =>
    typeof evidence.scanCode === "string" &&
    evidence.scanCode.length > 0 &&
    evidence.scanCode === accessPoint.scanCode,
});

module.exports = {
  registerValidationRule,
  getValidationRule,
  isKnownValidationRuleType,
  VALIDATION_RULE_TYPES,
};
