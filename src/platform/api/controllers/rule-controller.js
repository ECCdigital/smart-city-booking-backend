const RuleService = require("../../../commons/services/rule-service");

/**
 * Web Controller for the rules. The right is the router's (`rule.read`,
 * `rule.write`, `rule.run`: the instance owner).
 */
class RuleController {
  static async getMetadata(request, response) {
    return await withErrorStatus(response, async () => {
      response.status(200).send(RuleService.getMetadata());
    });
  }

  static async getRules(request, response) {
    return await withErrorStatus(response, async () => {
      const rules = await RuleService.getRules();
      response.status(200).send(rules);
    });
  }

  static async getRule(request, response) {
    return await withErrorStatus(response, async () => {
      const rule = await RuleService.getRule(request.params.id);
      response.status(200).send(rule);
    });
  }

  static async createRule(request, response) {
    return await withErrorStatus(response, async () => {
      const rule = await RuleService.createRule(request.body, request.user.id);
      response.status(201).send(rule);
    });
  }

  static async updateRule(request, response) {
    return await withErrorStatus(response, async () => {
      const rule = await RuleService.updateRule(
        request.params.id,
        request.body,
        request.user.id,
      );
      response.status(200).send(rule);
    });
  }

  static async setRuleEnabled(request, response) {
    return await withErrorStatus(response, async () => {
      const rule = await RuleService.setRuleEnabled(
        request.params.id,
        request.body?.enabled,
        request.user.id,
      );
      response.status(200).send(rule);
    });
  }

  static async deleteRule(request, response) {
    return await withErrorStatus(response, async () => {
      await RuleService.deleteRule(request.params.id);
      response.status(204).send();
    });
  }

  static async runRule(request, response) {
    return await withErrorStatus(response, async () => {
      const executionLog = await RuleService.runRule(request.params.id);
      response.status(200).send(executionLog);
    });
  }

  static async dryRunRule(request, response) {
    return await withErrorStatus(response, async () => {
      const executionLog = await RuleService.dryRunRule(request.params.id);
      response.status(200).send(executionLog);
    });
  }

  static async getExecutionLogs(request, response) {
    return await withErrorStatus(response, async () => {
      const logs = await RuleService.getExecutionLogs(request.query);
      response.status(200).send(logs);
    });
  }

  static async getRuleExecutionLogs(request, response) {
    return await withErrorStatus(response, async () => {
      const logs = await RuleService.getExecutionLogs({
        ...request.query,
        ruleId: request.params.id,
      });
      response.status(200).send(logs);
    });
  }
}

/** Runs a handler and answers its error with the error's status. */
async function withErrorStatus(response, handler) {
  try {
    return await handler();
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return response.status(statusCode).send({
      message: error.message,
      errors: error.errors,
    });
  }
}

module.exports = RuleController;
