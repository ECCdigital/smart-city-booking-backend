const { taskSchemaDefinition } = require("../../schemas/workflowSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class Task {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(taskSchemaDefinition);
    Object.assign(this, defaults, params);
  }

  validate() {
    return SchemaUtils.validate(this, taskSchemaDefinition);
  }

  static create(params) {
    const task = new Task(params);
    task.validate();
    return task;
  }
}

module.exports = Task;
