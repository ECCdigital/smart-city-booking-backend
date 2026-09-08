const { getValidationRule } = require("./access-validation-rules");

/**
 * Whether an access point field holds a usable value. An empty object or an
 * empty string is treated like a field nobody filled in, so a rule does not
 * become active on a half-configured door.
 */
function isPresent(value) {
  if (value === null || value === undefined || value === "") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

/**
 * The configuration side of the evidence rules: whether a rule can be used at
 * an access point at all. Whether evidence meets the rules is the access
 * decision's business (`access-decision.js`, `satisfy`), which asks the same
 * question of the stored door at opening time.
 */
class AccessEvidenceService {
  /**
   * The preconditions a rule configuration does not meet at an access point.
   *
   * Used twice for the same question: the management API refuses to save a rule
   * whose preconditions are unmet, and the access decision refuses to open a
   * door whose state drifted away from them afterwards.
   *
   * Rule types this server does not implement are left out - whether a type
   * exists at all is the schema's decision, not a precondition.
   *
   * @param {Object|null} accessPoint The access point in its submitted or
   *   stored state
   * @returns {{ ruleType: string, requires: string[] }[]} One entry per rule
   *   that cannot be used on this access point
   */
  static findUnmetPreconditions(accessPoint) {
    return (accessPoint?.validationRules || []).flatMap((configuredRule) => {
      const rule = getValidationRule(configuredRule.type);

      if (!rule || this.hasPreconditions(rule, accessPoint)) {
        return [];
      }

      return [{ ruleType: rule.type, requires: [...rule.requires] }];
    });
  }

  /**
   * Whether an access point provides everything a rule needs to be evaluated.
   *
   * @param {Object} rule The rule implementation, as registered
   * @param {Object|null} accessPoint The access point in its submitted or
   *   stored state
   * @returns {boolean} True if every required field holds a usable value
   */
  static hasPreconditions(rule, accessPoint) {
    return rule.requires.every((field) => isPresent(accessPoint?.[field]));
  }
}

module.exports = AccessEvidenceService;
