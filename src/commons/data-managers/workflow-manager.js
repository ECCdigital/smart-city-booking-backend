const Workflow = require("../entities/workflow/workflow");
const BookingManager = require("./booking-manager");
const WorkflowModel = require("./models/workflowModel");

class WorkflowManager {
  /**
   * Get complete workflow for a tenant
   * @param {string} tenantId
   * @returns {Promise<Workflow|null>}
   */
  static async getWorkflow(tenantId) {
    const rawWorkflow = await WorkflowModel.findOne({ tenantId: tenantId });
    if (!rawWorkflow) {
      return null;
    }
    return rawWorkflow.toEntity();
  }

  /**
   * Get only workflow states (without metadata)
   * @param {string} tenantId
   * @returns {Promise<Object|null>}
   */
  static async getWorkflowStates(tenantId) {
    const workflow = await this.getWorkflow(tenantId);
    if (!workflow) {
      return null;
    }
    return workflow.exportStatesOnly();
  }

  /**
   * Get tasks with optional booking population
   * @param {string} tenantId
   * @param {boolean} populate
   * @returns {Promise<Array|null>}
   */
  static async getTasks(tenantId, populate = false) {
    const rawWorkflow = await WorkflowModel.findOne({ tenantId: tenantId });
    if (!rawWorkflow) {
      return null;
    }

    const states = rawWorkflow.states;

    if (populate) {
      return await this.populateTasksWithBookings(states, tenantId);
    }

    return states;
  }

  /**
   * Create a new workflow
   * @param {string} tenantId
   * @param {Object} workflowData
   * @returns {Promise<Workflow>}
   */
  static async createWorkflow(tenantId, workflowData) {
    const workflow = Workflow.create({ tenantId, ...workflowData });
    await WorkflowModel.create(workflow);
    return workflow;
  }

  /**
   * Update an existing workflow
   * @param {string} tenantId
   * @param {Object} workflowData
   * @returns {Promise<Workflow|null>}
   */
  static async updateWorkflow(tenantId, workflowData) {
    const workflow =
      workflowData instanceof Workflow
        ? workflowData
        : new Workflow(workflowData);

    workflow.validate();

    await WorkflowModel.updateOne({ tenantId }, workflow);
    return await this.getWorkflow(tenantId);
  }

  /**
   * Update workflow tasks/states
   * @param {string} tenantId
   * @param {string} workflowId
   * @param {Array} states
   * @returns {Promise<void>}
   */
  static async updateTasks(tenantId, workflowId, states) {
    await WorkflowModel.updateOne(
      { tenantId, _id: workflowId },
      { states: states },
    );
  }

  /**
   * Archive tasks
   * @param {string} tenantId
   * @param {string} workflowId
   * @param {Array} archive
   * @returns {Promise<void>}
   */
  static async archiveTask(tenantId, workflowId, archive) {
    await WorkflowModel.updateOne({ tenantId, _id: workflowId }, { archive });
  }

  /**
   * Remove task from archive
   * @param {string} tenantId
   * @param {string} workflowId
   * @param {string} taskId
   * @returns {Promise<void>}
   */
  static async removeTaskFromArchive(tenantId, workflowId, taskId) {
    await WorkflowModel.updateOne(
      { tenantId, _id: workflowId },
      { $pull: { archive: { id: taskId } } },
    );
  }

  /**
   * Helper method to populate tasks with booking data
   * @private
   */
  static async populateTasksWithBookings(states, tenantId) {
    for (const state of states) {
      state.tasks = await Promise.all(
        state.tasks.map(async (task) => {
          return {
            ...task.toObject(),
            bookingItem: await BookingManager.getBooking(task.id, tenantId),
          };
        }),
      );
    }
    return states;
  }
}

module.exports = WorkflowManager;
