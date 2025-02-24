const mongoose = require("mongoose");
const Workflow = require("../../entities/workflow");
const { Schema } = mongoose;

const WorkflowSchema = new Schema(Workflow.schema());

module.exports =
  mongoose.models.Workflow || mongoose.model("Workflow", WorkflowSchema);
