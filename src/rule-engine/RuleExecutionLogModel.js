const mongoose = require("mongoose");
const { Schema } = mongoose;

const RULE_EXECUTION_STATUS = ["success", "error", "partial", "skipped"];
const RULE_EXECUTION_TRIGGER = ["schedule", "manual"];
const RULE_ACTION_RESULT_STATUS = ["success", "error", "skipped"];

// Retention period for execution logs (in seconds). Defaults to 90 days.
const LOG_TTL_SECONDS =
  Number(process.env.RULE_LOG_TTL_SECONDS) || 90 * 24 * 60 * 60;

const ActionResultSchema = new Schema(
  {
    actionType: { type: String, required: true },
    docId: { type: String, default: null },
    status: {
      type: String,
      enum: RULE_ACTION_RESULT_STATUS,
      required: true,
    },
    message: { type: String, default: null },
  },
  { _id: false },
);

const RuleExecutionLogSchema = new Schema(
  {
    ruleId: { type: Schema.Types.ObjectId, ref: "Rule", default: null },
    // Denormalized so logs stay readable even after the rule is deleted.
    ruleName: { type: String, default: null },

    trigger: {
      type: String,
      enum: RULE_EXECUTION_TRIGGER,
      default: "schedule",
    },
    status: {
      type: String,
      enum: RULE_EXECUTION_STATUS,
      required: true,
    },

    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },

    matchedCount: { type: Number, default: 0 },
    processedCount: { type: Number, default: 0 },

    actionResults: { type: [ActionResultSchema], default: [] },
    error: { type: String, default: null },
  },
  { timestamps: true },
);

RuleExecutionLogSchema.index({ ruleId: 1, startedAt: -1 });
RuleExecutionLogSchema.index({ startedAt: -1 });
RuleExecutionLogSchema.index(
  { startedAt: 1 },
  { expireAfterSeconds: LOG_TTL_SECONDS },
);

const RuleExecutionLog =
  mongoose.models.RuleExecutionLog ||
  mongoose.model("RuleExecutionLog", RuleExecutionLogSchema);

module.exports = RuleExecutionLog;
module.exports.RULE_EXECUTION_STATUS = RULE_EXECUTION_STATUS;
module.exports.RULE_EXECUTION_TRIGGER = RULE_EXECUTION_TRIGGER;
module.exports.RULE_ACTION_RESULT_STATUS = RULE_ACTION_RESULT_STATUS;
