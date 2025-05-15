const schedule = require("node-schedule");
const jsonLogic = require("json-logic-js");
const mongoose = require("mongoose");
const actionRegistry = require("./actionRegistry");
const Rule = require("./RuleModel");
const { transformPlaceholders, buildFacts } = require("./utils");
const crypto = require("crypto");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "ruleEngine",
  level: process.env.LOG_LEVEL,
});

class RuleEngine {
  static jobs = new Map();

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
        if (existing) {
          existing.job.cancel();
        }

        const job = schedule.scheduleJob(rule.schedule, createHandler(rule));
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
  }
}

function createHandler(rule) {
  return async () => {
    try {
      logger.info(`Executing rule ${rule.name}...`);

      const Model = mongoose.model(rule.resource);
      const now = new Date();
      const mongoQuery = rule.query
        ? transformPlaceholders(rule.query, now)
        : {};
      const docs = await Model.find(mongoQuery).lean();

      for (const doc of docs) {
        const facts = buildFacts(doc, now);
        if (rule.conditions && !jsonLogic.apply(rule.conditions, facts))
          continue;
        for (const act of rule.actions) {
          const handler = actionRegistry[act.type];
          if (!handler) continue;
          try {
            await handler(doc, act.params);
          } catch (err) {
            logger.error(
              `Error executing action "${act.type}" for rule "${rule.name}":`,
              err,
            );
          }
        }
      }
    } catch (err) {
      logger.error(`Error executing rule "${rule.name}":`, err);
    }
  };
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
