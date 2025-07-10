const { workflowSchemaDefinition } = require("../../schemas/workflowSchema");
const SchemaUtils = require("../../utilities/schemaUtils");
const State = require("./state");

class Workflow {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(workflowSchemaDefinition);
    Object.assign(this, defaults, params);

    // Convert states to State entities
    if (this.states && Array.isArray(this.states)) {
      this.states = this.states.map((state) =>
        state instanceof State ? state : new State(state),
      );
    }
  }

  addState(state) {
    const stateEntity = state instanceof State ? state : new State(state);
    stateEntity.validate();
    this.states.push(stateEntity);
    return stateEntity;
  }

  removeState(stateId) {
    this.states = this.states.filter((state) => state.id !== stateId);
  }

  getState(stateId) {
    return this.states.find((state) => state.id === stateId);
  }

  getStateByName(stateName) {
    return this.states.find((state) => state.name === stateName);
  }

  addTaskToState(stateId, task) {
    const state = this.getState(stateId);
    if (!state) {
      throw new Error(`State with id ${stateId} not found`);
    }
    return state.addTask(task);
  }

  removeTaskFromState(stateId, taskId) {
    const state = this.getState(stateId);
    if (!state) {
      throw new Error(`State with id ${stateId} not found`);
    }
    state.removeTask(taskId);
  }

  getAllTasks() {
    return this.states.flatMap((state) => state.tasks);
  }

  findTask(taskId) {
    for (const state of this.states) {
      const task = state.getTask(taskId);
      if (task) {
        return { task, state };
      }
    }
    return null;
  }

  archiveTask(taskId) {
    const result = this.findTask(taskId);
    if (!result) {
      throw new Error(`Task with id ${taskId} not found`);
    }

    const { task, state } = result;
    state.removeTask(taskId);
    this.archive.push(task);
    return task;
  }

  restoreTaskFromArchive(taskId, targetStateId) {
    const archivedTaskIndex = this.archive.findIndex(
      (task) => task.id === taskId,
    );
    if (archivedTaskIndex === -1) {
      throw new Error(`Archived task with id ${taskId} not found`);
    }

    const task = this.archive.splice(archivedTaskIndex, 1)[0];
    this.addTaskToState(targetStateId, task);
    return task;
  }

  removeFromArchive(taskId) {
    this.archive = this.archive.filter((task) => task.id !== taskId);
  }

  exportStatesOnly() {
    return {
      states: this.states,
      archive: this.archive,
      active: this.active,
    };
  }

  validate() {
    return SchemaUtils.validate(this, workflowSchemaDefinition);
  }

  static create(params) {
    const workflow = new Workflow(params);
    workflow.validate();
    return workflow;
  }
}

module.exports = Workflow;
