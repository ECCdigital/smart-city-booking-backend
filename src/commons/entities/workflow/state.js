const { stateSchemaDefinition } = require("../../schemas/workflowSchema");
const SchemaUtils = require("../../utilities/schemaUtils");
const Task = require("./task");

class State {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(stateSchemaDefinition);
    Object.assign(this, defaults, params);

    // Convert tasks to Task entities
    if (this.tasks && Array.isArray(this.tasks)) {
      this.tasks = this.tasks.map((task) =>
        task instanceof Task ? task : new Task(task),
      );
    }
  }

  addTask(task) {
    const taskEntity = task instanceof Task ? task : new Task(task);
    taskEntity.validate();
    this.tasks.push(taskEntity);
    return taskEntity;
  }

  removeTask(taskId) {
    this.tasks = this.tasks.filter((task) => task.id !== taskId);
  }

  getTask(taskId) {
    return this.tasks.find((task) => task.id === taskId);
  }

  validate() {
    return SchemaUtils.validate(this, stateSchemaDefinition);
  }

  static create(params) {
    const state = new State(params);
    state.validate();
    return state;
  }
}

module.exports = State;
