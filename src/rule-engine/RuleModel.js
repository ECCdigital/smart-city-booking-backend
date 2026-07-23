const mongoose = require("mongoose");
const { Schema } = mongoose;

const ActionSchema = new Schema(
  {
    type: { type: String, required: true },
    params: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const RULE_RUN_STATUS = ["success", "error", "partial", "skipped"];

const RuleSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    enabled: { type: Boolean, default: true },
    schedule: { type: String, required: true },
    resource: { type: String, required: true },
    query: { type: Schema.Types.Mixed },
    conditions: { type: Schema.Types.Mixed },
    actions: { type: [ActionSchema], default: [] },

    // Audit / last execution snapshot (kept denormalized for quick list views)
    lastRunAt: { type: Date, default: null },
    lastRunStatus: { type: String, enum: RULE_RUN_STATUS, default: null },
    lastRunSummary: { type: Schema.Types.Mixed, default: null },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true },
);

const Rule = mongoose.models.Rule || mongoose.model("Rule", RuleSchema);

module.exports = Rule;
module.exports.RULE_RUN_STATUS = RULE_RUN_STATUS;
