const RuleModel = require("../../rule-engine/RuleModel");
const RuleExecutionLogModel = require("../../rule-engine/RuleExecutionLogModel");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

class RuleManager {
  static async getRules() {
    return await RuleModel.find({}).sort({ name: 1 }).lean();
  }

  static async getRule(ruleId) {
    return await RuleModel.findById(ruleId).lean();
  }

  static async createRule(rule) {
    return await RuleModel.create(rule);
  }

  static async updateRule(ruleId, rule) {
    return await RuleModel.findByIdAndUpdate(ruleId, rule, {
      new: true,
      runValidators: true,
    }).lean();
  }

  static async deleteRule(ruleId) {
    return await RuleModel.findByIdAndDelete(ruleId).lean();
  }

  static async getExecutionLogs({
    ruleId = null,
    status = null,
    from = null,
    to = null,
    limit = DEFAULT_LIMIT,
    offset = 0,
  } = {}) {
    const filter = {};

    if (ruleId) {
      filter.ruleId = ruleId;
    }

    if (status) {
      filter.status = status;
    }

    if (from || to) {
      filter.startedAt = {};
      if (from) filter.startedAt.$gte = new Date(from);
      if (to) filter.startedAt.$lte = new Date(to);
    }

    const parsedLimit = Math.min(
      Math.max(Number(limit) || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const parsedOffset = Math.max(Number(offset) || 0, 0);

    const [items, total] = await Promise.all([
      RuleExecutionLogModel.find(filter)
        .sort({ startedAt: -1 })
        .skip(parsedOffset)
        .limit(parsedLimit)
        .lean(),
      RuleExecutionLogModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      limit: parsedLimit,
      offset: parsedOffset,
    };
  }
}

module.exports = RuleManager;
