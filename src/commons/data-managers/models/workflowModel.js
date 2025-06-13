const mongoose = require("mongoose");
const { Double } = require("mongodb");
const { Schema } = mongoose;


/**
 * Schema for a task within a workflow.
 *
 * @property {String} id - The unique ID of the task. Required.
 * @property {Double} [added=null] - An optional value indicating when the task was added.
 */
const TaskSchema = new Schema(
  {
    id: { type: String, required: true },
    added: { type: Double, default: null },
  },
  {
    _id: false,
    toObject: { virtuals: true },
    toJSON: { virtuals: true },
  },
);


/**
 * Virtual field for linking to a Booking document.
 *
 * @property {String} ref - The name of the referenced model ("Booking").
 * @property {String} localField - The local field used for linking ("id").
 * @property {String} foreignField - The foreign field used for linking ("id").
 * @property {Boolean} justOne - Indicates that only one document is linked.
 */
TaskSchema.virtual("bookingDoc", {
  ref: "Booking",
  localField: "id",
  foreignField: "id",
  justOne: true,
});

/**
 * Schema for a state within a workflow.
 *
 * @property {String} id - The unique ID of the state. Required.
 * @property {String} name - The name of the state. Required.
 * @property {Array<Object>} [actions=[]] - A list of actions associated with the state.
 * @property {Array<TaskSchema>} [tasks=[]] - A list of tasks associated with the state.
 */
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

/**
 * Schema for a workflow.
 *
 * @property {String} tenantId - The ID of the tenant the workflow belongs to. Required.
 * @property {String} [name=""] - The name of the workflow.
 * @property {String} [description=""] - The description of the workflow.
 * @property {Array<StateSchema>} [states=[]] - A list of states defined in the workflow.
 * @property {Array<Mixed>} [archive=[]] - Archived data associated with the workflow.
 * @property {String} [defaultState=""] - The default state of the workflow.
 * @property {Boolean} [active=false] - Indicates whether the workflow is active.
 */
const WorkflowSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    name: { type: String, default: "" },
    description: { type: String, default: "" },
    states: { type: [StateSchema], default: [] },
    archive: { type: [Schema.Types.Mixed], default: [] },
    defaultState: { type: String, default: "" },
    active: { type: Boolean, default: false },
  },
  {
    toObject: { virtuals: true },
    toJSON: { virtuals: true },
  },
);

module.exports =
  mongoose.models.Workflow || mongoose.model("Workflow", WorkflowSchema);
