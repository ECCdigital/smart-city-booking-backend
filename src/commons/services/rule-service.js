const RuleManager = require("../data-managers/rule-manager");
const RuleEngine = require("../../rule-engine/ruleEngine");

class RuleValidationError extends Error {
  constructor(errors) {
    super(errors.join(", "));
    this.name = "RuleValidationError";
    this.statusCode = 400;
    this.errors = errors;
  }
}

class RuleService {
  static getMetadata() {
    return {
      allowedResources: RuleEngine.getAllowedResources(),
      allowedActions: RuleEngine.getAllowedActions(),
    };
  }

  static async getRules() {
    return await RuleManager.getRules();
  }

  static async getRule(ruleId) {
    const rule = await RuleManager.getRule(ruleId);
    if (!rule) {
      throwNotFound(ruleId);
    }
    return rule;
  }

  static async createRule(rule, userId) {
    RuleService.validateRule(rule);

    const created = await RuleManager.createRule({
      ...rule,
      createdBy: userId || null,
      updatedBy: userId || null,
    });

    await RuleService.reloadSchedulerIfRunning();
    return created;
  }

  static async updateRule(ruleId, rule, userId) {
    RuleService.validateRule(rule);

    const updated = await RuleManager.updateRule(ruleId, {
      ...rule,
      updatedBy: userId || null,
    });

    if (!updated) {
      throwNotFound(ruleId);
    }

    await RuleService.reloadSchedulerIfRunning();
    return updated;
  }

  static async setRuleEnabled(ruleId, enabled, userId) {
    const updated = await RuleManager.updateRule(ruleId, {
      enabled: enabled === true,
      updatedBy: userId || null,
    });

    if (!updated) {
      throwNotFound(ruleId);
    }

    await RuleService.reloadSchedulerIfRunning();
    return updated;
  }

  static async deleteRule(ruleId) {
    const deleted = await RuleManager.deleteRule(ruleId);
    if (!deleted) {
      throwNotFound(ruleId);
    }

    await RuleService.reloadSchedulerIfRunning();
    return deleted;
  }

  static async runRule(ruleId) {
    await RuleService.getRule(ruleId);
    return await RuleEngine.runRule(ruleId, { trigger: "manual" });
  }

  static async dryRunRule(ruleId) {
    await RuleService.getRule(ruleId);
    return await RuleEngine.dryRunRule(ruleId, { trigger: "manual" });
  }

  static async getExecutionLogs(query = {}) {
    return await RuleManager.getExecutionLogs(query);
  }

  static validateRule(rule) {
    const validation = RuleEngine.validateRuleDefinition(rule, {
      validateSchedule: true,
    });

    if (!validation.valid) {
      throw new RuleValidationError(validation.errors);
    }
  }

  static async reloadSchedulerIfRunning() {
    if (RuleEngine.isInitialized()) {
      await RuleEngine.loadAndScheduleRules();
    }
  }
}

function throwNotFound(ruleId) {
  const error = new Error(`Rule "${ruleId}" not found`);
  error.statusCode = 404;
  throw error;
}

module.exports = RuleService;
module.exports.RuleValidationError = RuleValidationError;
