const { Double } = require("mongodb");
const { Schema } = require("mongoose");

const taskSchemaDefinition = {
  id: { type: String, required: true },
  added: { type: Double, default: null },
};

const stateSchemaDefinition = {
  id: { type: String, required: true },
  name: { type: String, required: true },
  actions: { type: [Object], default: [] },
  tasks: { type: [taskSchemaDefinition], default: [] },
};

const workflowSchemaDefinition = {
  tenantId: { type: String, required: true },
  name: { type: String, default: "" },
  description: { type: String, default: "" },
  states: { type: [stateSchemaDefinition], default: [] },
  archive: { type: [Schema.Types.Mixed], default: [] },
  defaultState: { type: String, default: "" },
  active: { type: Boolean, default: false },
};

module.exports = {
  workflowSchemaDefinition,
  stateSchemaDefinition,
  taskSchemaDefinition,
};
