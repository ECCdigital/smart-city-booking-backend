const mongoose = require("mongoose");
const { Schema } = mongoose;

const ActionSchema = new Schema(
  {
    type: { type: String, required: true },
    params: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const RuleSchema = new Schema(
  {
    name: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    schedule: { type: String, required: true },
    resource: { type: String, required: true },
    query: { type: Schema.Types.Mixed },
    conditions: { type: Schema.Types.Mixed },
    actions: { type: [ActionSchema], default: [] },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Rule", RuleSchema);
