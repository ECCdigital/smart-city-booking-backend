const schedule = require("node-schedule");
const jsonLogic = require("json-logic-js");
const mongoose = require("mongoose");
const actionRegistry = require("./actionRegistry");
const aggregateActionRegistry = require("./aggregateActionRegistry");
const Rule = require("./RuleModel");
const RuleExecutionLog = require("./RuleExecutionLogModel");
const { transformPlaceholders, buildFacts } = require("./utils");
const { RESOURCE_CATALOG } = require("./ruleMetadata");
const TenantManager = require("../commons/data-managers/tenant-manager");
const crypto = require("crypto");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "ruleEngine",
  level: process.env.LOG_LEVEL,
});

const ALLOWED_RESOURCES = new Set(Object.keys(RESOURCE_CATALOG));
const MAX_ACTION_RESULTS = Number(process.env.RULE_MAX_ACTION_RESULTS) || 500;

class RuleEngine {
  static jobs = new Map();
  static initialized = false;

  static isInitialized() {
    return RuleEngine.initialized === true;
  }

  static isEngineEnabled() {
    return process.env.RULE_ENGINE_ENABLED === "true";
  }

  static getAllowedResources() {
    return Array.from(ALLOWED_RESOURCES);
  }

  static getAllowedActions() {
    return [
      ...Object.keys(actionRegistry),
      ...Object.keys(aggregateActionRegistry),
    ];
  }

  static isAggregateAction(type) {
    return Boolean(aggregateActionRegistry[type]);
  }

  static validateRuleDefinition(rule, { validateSchedule = false } = {}) {
    const errors = [];

    if (!rule?.name) errors.push("name is required");
    if (!rule?.schedule) errors.push("schedule is required");
    if (validateSchedule && rule?.schedule && !isScheduleValid(rule.schedule)) {
      errors.push(`schedule "${rule.schedule}" is invalid`);
    }

    if (!ALLOWED_RESOURCES.has(rule?.resource)) {
      errors.push(`resource "${rule?.resource}" is not allowed`);
    }

    for (const action of rule?.actions || []) {
      if (
        !actionRegistry[action.type] &&
        !aggregateActionRegistry[action.type]
      ) {
        errors.push(`action "${action.type}" is not allowed`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  static async runRule(ruleOrId, options = {}) {
    const rule = await resolveRule(ruleOrId);
    return executeRule(rule, {
      trigger: options.trigger || "manual",
      dryRun: options.dryRun === true,
    });
  }

  static async dryRunRule(ruleOrId, options = {}) {
    return RuleEngine.runRule(ruleOrId, {
      ...options,
      dryRun: true,
      trigger: options.trigger || "manual",
    });
  }

  static async loadAndScheduleRules() {
    const allRules = await Rule.find({}).lean();
    const enabled = new Map(
      allRules.filter((r) => r.enabled).map((r) => [r._id.toString(), r]),
    );

    for (const [id, { job }] of RuleEngine.jobs.entries()) {
      if (!enabled.has(id)) {
        job.cancel();
        RuleEngine.jobs.delete(id);
      }
    }

    for (const [id, rule] of enabled.entries()) {
      const existing = RuleEngine.jobs.get(id);
      const ruleHash = hashRule(rule);

      if (!existing || existing.ruleHash !== ruleHash) {
        const validation = RuleEngine.validateRuleDefinition(rule, {
          validateSchedule: true,
        });
        if (!validation.valid) {
          logger.error(
            `Invalid rule "${rule.name}" (${id}): ${validation.errors.join(", ")}`,
          );
          if (existing) {
            existing.job.cancel();
            RuleEngine.jobs.delete(id);
          }
          continue;
        }

        const job = schedule.scheduleJob(rule.schedule, createHandler(rule));

        if (!job) {
          logger.error(
            `Invalid schedule "${rule.schedule}" for rule "${rule.name}" (${id}). Rule was not scheduled.`,
          );
          if (existing) {
            existing.job.cancel();
            RuleEngine.jobs.delete(id);
          }
          continue;
        }

        if (existing) {
          existing.job.cancel();
        }

        RuleEngine.jobs.set(id, {
          job,
          schedule: rule.schedule,
          ruleHash,
        });
      }
    }
  }

  static async initEngine() {
    await RuleEngine.loadAndScheduleRules();
    schedule.scheduleJob("*/15 * * * *", () => {
      RuleEngine.loadAndScheduleRules().catch((err) =>
        logger.error("Error loading rules:", err),
      );
    });
    RuleEngine.initialized = true;
  }
}

function createHandler(rule) {
  return async () => {
    await executeRule(rule, { trigger: "schedule" });
  };
}

async function executeRule(
  rule,
  { trigger = "schedule", dryRun = false } = {},
) {
  const startedAt = new Date();
  const summary = {
    matchedCount: 0,
    processedCount: 0,
    actionResults: [],
    error: null,
  };

  try {
    const validation = RuleEngine.validateRuleDefinition(rule);
    if (!validation.valid) {
      throw new Error(validation.errors.join(", "));
    }

    logger.info(`Executing rule ${rule.name}...`);

    const Model = mongoose.model(rule.resource);
    const now = new Date();
    const mongoQuery = rule.query ? transformPlaceholders(rule.query, now) : {};
    const docs = await Model.find(mongoQuery).lean();

    const allActions = rule.actions || [];
    const perDocActions = allActions.filter(
      (act) => !RuleEngine.isAggregateAction(act.type),
    );
    const aggregateActions = allActions.filter((act) =>
      RuleEngine.isAggregateAction(act.type),
    );

    // Filter the documents that satisfy the conditions.
    const matchedDocs = [];
    for (const doc of docs) {
      const facts = buildFacts(doc, now);
      if (rule.conditions && !jsonLogic.apply(rule.conditions, facts)) {
        continue;
      }
      matchedDocs.push(doc);
    }
    summary.matchedCount = matchedDocs.length;

    const tenantMailCache = new Map();

    // Per-document actions: executed once per matched document.
    for (const doc of matchedDocs) {
      if (!dryRun) {
        summary.processedCount += 1;
      }

      for (const act of perDocActions) {
        if (dryRun) {
          pushActionResult(summary.actionResults, {
            actionType: act.type,
            docId: getDocId(doc),
            status: "skipped",
            message: "Dry run: action was not executed.",
          });
          continue;
        }

        try {
          const params = await resolveActionParams(
            act.params || {},
            doc.tenantId,
            tenantMailCache,
          );
          await actionRegistry[act.type](doc, params);
          pushActionResult(summary.actionResults, {
            actionType: act.type,
            docId: getDocId(doc),
            status: "success",
          });
        } catch (err) {
          logActionError(act.type, rule.name, err);
          pushActionResult(summary.actionResults, {
            actionType: act.type,
            docId: getDocId(doc),
            status: "error",
            message: getErrorMessage(err),
          });
        }
      }
    }

    // Aggregate actions: matched documents are grouped by tenant and the
    // action runs once per tenant group.
    if (aggregateActions.length > 0) {
      const groups = groupByTenant(matchedDocs);

      for (const act of aggregateActions) {
        if (dryRun) {
          pushActionResult(summary.actionResults, {
            actionType: act.type,
            docId: null,
            status: "skipped",
            message: `Dry run: action was not executed (${matchedDocs.length} matched in ${groups.size} tenant group(s)).`,
          });
          continue;
        }

        for (const [tenantId, groupDocs] of groups.entries()) {
          try {
            const tenantMail = await getTenantMail(tenantId, tenantMailCache);
            const params = resolvePlaceholdersInParams(
              act.params || {},
              tenantMail,
            );
            await aggregateActionRegistry[act.type](groupDocs, params, {
              tenantId,
              tenantMail,
            });
            pushActionResult(summary.actionResults, {
              actionType: act.type,
              docId: tenantId,
              status: "success",
            });
          } catch (err) {
            logActionError(act.type, rule.name, err);
            pushActionResult(summary.actionResults, {
              actionType: act.type,
              docId: tenantId,
              status: "error",
              message: getErrorMessage(err),
            });
          }
        }
      }
    }

    return await finalizeExecution(rule, {
      startedAt,
      trigger,
      dryRun,
      summary,
    });
  } catch (err) {
    summary.error = getErrorMessage(err);
    logger.error(`Error executing rule "${rule.name}":`, err);

    return await finalizeExecution(rule, {
      startedAt,
      trigger,
      dryRun,
      summary,
      topLevelError: true,
    });
  }
}

async function finalizeExecution(
  rule,
  { startedAt, trigger, dryRun, summary, topLevelError = false },
) {
  const finishedAt = new Date();
  const status = getExecutionStatus(summary, { dryRun, topLevelError });
  const lastRunSummary = {
    matchedCount: summary.matchedCount,
    processedCount: summary.processedCount,
    actionResultCount: summary.actionResults.length,
    error: summary.error,
  };

  const executionLog = await RuleExecutionLog.create({
    ruleId: rule._id || null,
    ruleName: rule.name,
    trigger,
    status,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    matchedCount: summary.matchedCount,
    processedCount: summary.processedCount,
    actionResults: summary.actionResults,
    error: summary.error,
  });

  if (rule._id) {
    await Rule.updateOne(
      { _id: rule._id },
      {
        $set: {
          lastRunAt: finishedAt,
          lastRunStatus: status,
          lastRunSummary,
        },
      },
    );
  }

  return executionLog;
}

function groupByTenant(docs) {
  const groups = new Map();
  for (const doc of docs) {
    const tenantId = doc.tenantId || null;
    if (!groups.has(tenantId)) {
      groups.set(tenantId, []);
    }
    groups.get(tenantId).push(doc);
  }
  return groups;
}

async function getTenantMail(tenantId, cache) {
  if (!tenantId) return null;
  if (cache.has(tenantId)) return cache.get(tenantId);

  let mail = null;
  try {
    const tenant = await TenantManager.getTenant(tenantId);
    mail = tenant?.mail || null;
  } catch (err) {
    logger.error(`Could not resolve tenant mail for "${tenantId}":`, err);
  }

  cache.set(tenantId, mail);
  return mail;
}

/**
 * Resolves placeholders in per-document action params. Only performs the
 * (async) tenant lookup when the params actually reference $$TENANT_MAIL.
 */
async function resolveActionParams(params, tenantId, cache) {
  if (!paramsContainTenantMail(params)) {
    return params;
  }
  const tenantMail = await getTenantMail(tenantId, cache);
  return resolvePlaceholdersInParams(params, tenantMail);
}

function paramsContainTenantMail(params) {
  try {
    return JSON.stringify(params).includes("$$TENANT_MAIL");
  } catch {
    return false;
  }
}

function resolvePlaceholdersInParams(value, tenantMail) {
  if (value === "$$TENANT_MAIL") {
    return tenantMail || "";
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolvePlaceholdersInParams(item, tenantMail));
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = resolvePlaceholdersInParams(val, tenantMail);
    }
    return result;
  }
  return value;
}

function logActionError(actionType, ruleName, err) {
  logger.error(
    `Error executing action "${actionType}" for rule "${ruleName}":`,
    err,
  );
}

async function resolveRule(ruleOrId) {
  if (
    typeof ruleOrId === "string" ||
    ruleOrId instanceof mongoose.Types.ObjectId
  ) {
    const rule = await Rule.findById(ruleOrId).lean();
    if (!rule) {
      throw new Error(`Rule "${ruleOrId}" not found`);
    }
    return rule;
  }

  return ruleOrId;
}

function getExecutionStatus(summary, { dryRun, topLevelError }) {
  if (topLevelError) return "error";
  if (dryRun) return "skipped";
  if (summary.actionResults.some((result) => result.status === "error")) {
    return summary.actionResults.some((result) => result.status === "success")
      ? "partial"
      : "error";
  }
  return "success";
}

function pushActionResult(actionResults, result) {
  if (actionResults.length < MAX_ACTION_RESULTS) {
    actionResults.push(result);
  }
}

function getDocId(doc) {
  return doc?.id || doc?._id?.toString?.() || null;
}

function getErrorMessage(err) {
  return err?.message || String(err);
}

function isScheduleValid(scheduleExpression) {
  const job = schedule.scheduleJob(scheduleExpression, () => {});
  if (!job) {
    return false;
  }

  job.cancel();
  return true;
}

function hashRule(rule) {
  const data = JSON.stringify({
    schedule: rule.schedule,
    query: rule.query,
    conditions: rule.conditions,
    actions: rule.actions,
    resource: rule.resource,
  });
  return crypto.createHash("sha256").update(data).digest("hex");
}

module.exports = RuleEngine;
