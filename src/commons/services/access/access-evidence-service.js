const {
  ACCESS_BLOCKING_REASONS,
  prioritizeBlockingReasons,
} = require("./access-blocking-reasons");
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
 * The evidence layer of the access decision: on top of the fixed booking
 * checks, an access point can demand evidence that the person is really
 * standing in front of it.
 *
 * The layer only ever adds requirements. An access point without rules behaves
 * exactly as before, and a rule this server cannot evaluate blocks the door
 * rather than being skipped - the whole point of a rule is that it is not
 * silently optional.
 */
class AccessEvidenceService {
  /**
   * Check the evidence a client sent against the rules of an access point.
   *
   * All configured rules have to be fulfilled; there are no alternatives. Each
   * rule picks its evidence by type, at most one per type, and anything else
   * the client sent is ignored rather than rejected - a client may know more
   * evidence types than this door asks for.
   *
   * @param {Object|null} accessPoint The access point being opened, as stored
   * @param {Object[]} [evidence=[]] Evidence objects as sent by the client
   * @param {Object} [options]
   * @param {boolean} [options.bypass=false] Skip the rules, e.g. for a user who
   *   may manage the bookings of the tenant. The booking checks still apply.
   * @returns {{ satisfied: boolean, bypassed: boolean, blockingReasons: string[],
   *   validatedEvidence: string[] }} Whether the door may open, whether rules
   *   were skipped, the prioritized reasons if not, and the rules that were
   *   actually proven.
   */
  static evaluate(accessPoint, evidence = [], { bypass = false } = {}) {
    const validationRules = accessPoint?.validationRules || [];

    if (validationRules.length === 0) {
      return {
        satisfied: true,
        bypassed: false,
        blockingReasons: [],
        validatedEvidence: [],
      };
    }

    if (bypass) {
      return {
        satisfied: true,
        bypassed: true,
        blockingReasons: [],
        validatedEvidence: [],
      };
    }

    const evidenceByType = this._indexEvidenceByType(evidence);
    const blockingReasons = [];
    const validatedEvidence = [];

    for (const configuredRule of validationRules) {
      const reason = this._evaluateRule(
        configuredRule,
        accessPoint,
        evidenceByType,
      );

      if (reason) {
        blockingReasons.push(reason);
      } else {
        validatedEvidence.push(configuredRule.type);
      }
    }

    const prioritized = prioritizeBlockingReasons(blockingReasons);

    return {
      satisfied: prioritized.length === 0,
      bypassed: false,
      blockingReasons: prioritized,
      validatedEvidence: prioritized.length === 0 ? validatedEvidence : [],
    };
  }

  /**
   * The outcome of a rule that cannot be evaluated: the door stays shut. Kept
   * here so callers that discover an unusable rule outside of
   * {@link evaluate} - e.g. an access point that vanished mid-request - report
   * it in exactly the same shape.
   *
   * @returns {{ satisfied: false, bypassed: false, blockingReasons: string[],
   *   validatedEvidence: string[] }} A fail-closed outcome
   */
  static ruleUnavailable() {
    return {
      satisfied: false,
      bypassed: false,
      blockingReasons: [ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE],
      validatedEvidence: [],
    };
  }

  /**
   * The preconditions a rule configuration does not meet at an access point.
   *
   * Used twice for the same question: the management API refuses to save a rule
   * whose preconditions are unmet, and {@link evaluate} refuses to open a door
   * whose state drifted away from them afterwards.
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

      if (!rule || this._hasPreconditions(rule, accessPoint)) {
        return [];
      }

      return [{ ruleType: rule.type, requires: [...rule.requires] }];
    });
  }

  /**
   * @private
   * Decides a single rule. Returns the blocking reason, or null when the rule
   * is fulfilled.
   */
  static _evaluateRule(configuredRule, accessPoint, evidenceByType) {
    const rule = getValidationRule(configuredRule.type);

    if (!rule || !this._hasPreconditions(rule, accessPoint)) {
      return ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE;
    }

    const evidence = evidenceByType.get(rule.type);

    if (!evidence) {
      return ACCESS_BLOCKING_REASONS.EVIDENCE_MISSING;
    }

    return rule.verify(evidence, accessPoint)
      ? null
      : ACCESS_BLOCKING_REASONS.EVIDENCE_INVALID;
  }

  /** @private */
  static _hasPreconditions(rule, accessPoint) {
    return rule.requires.every((field) => isPresent(accessPoint?.[field]));
  }

  /**
   * @private
   * Reduce the evidence list to one entry per type. The first entry of a type
   * wins, so a client cannot improve its chances by sending a type twice.
   */
  static _indexEvidenceByType(evidence) {
    const byType = new Map();

    for (const entry of Array.isArray(evidence) ? evidence : []) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof entry.type !== "string" ||
        byType.has(entry.type)
      ) {
        continue;
      }

      byType.set(entry.type, entry);
    }

    return byType;
  }
}

module.exports = AccessEvidenceService;
