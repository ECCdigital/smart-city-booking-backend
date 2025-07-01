const mongoose = require("mongoose");
const { workflowSchemaDefinition } = require("../../schemas/workflowSchema");
const { Schema } = mongoose;

// Create schemas with virtuals
const TaskSchema = new Schema(
  {
    id: { type: String, required: true },
    added: { type: mongoose.Schema.Types.Double, default: null },
  },
  {
    _id: false,
    toObject: { virtuals: true },
    toJSON: { virtuals: true },
  },
);

TaskSchema.virtual("bookingDoc", {
  ref: "Booking",
  localField: "id",
  foreignField: "id",
  justOne: true,
});

const StateSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    actions: { type: [Object], default: [] },
    tasks: { type: [TaskSchema], default: [] },
  },
  {
    _id: false,
    toObject: { virtuals: true },
    toJSON: { virtuals: true },
  },
);

const WorkflowSchema = new Schema(workflowSchemaDefinition, {
  toObject: { virtuals: true },
  toJSON: { virtuals: true },
});

// Override states field to use StateSchema
WorkflowSchema.add({
  states: { type: [StateSchema], default: [] },
});

// Instance method to convert to business entity
WorkflowSchema.methods.toEntity = function () {
  const Workflow = require("../../entities/workflow/workflow");
  return new Workflow(this.toObject());
};

module.exports =
  mongoose.models.Workflow || mongoose.model("Workflow", WorkflowSchema);
