const Workflow = require("../entities/workflow");
const BookingManager = require("./booking-manager");
const WorkflowModel = require("./models/workflowModel");

class WorkflowManager {
  static async getWorkflow(tenantId) {
    const rawWorkflow = await WorkflowModel.findOne({ tenantId: tenantId });
    if (!rawWorkflow) return {};
    return await createWorkflowFromModel(rawWorkflow);
  }

  static async getWorkflowStates(tenantId) {
    const rawWorkflow = await WorkflowModel.findOne({ tenantId: tenantId });
    if (!rawWorkflow) return {};
    return await createWorkflowFromModel(rawWorkflow, false);
  }

  static async getTasks(tenantId, populate = false) {
    const rawWorkflow = await WorkflowModel.findOne({ tenantId: tenantId });
    if (!rawWorkflow) return null;
    return await createStatusFromModel(rawWorkflow.states, tenantId, populate);
  }

  static async createWorkflow({
    tenantId,
    name,
    description,
    states,
    archive,
    active,
  }) {
    await WorkflowModel.create({
      tenantId,
      name,
      description,
      states,
      archive,
      active,
    });
    return await WorkflowManager.getWorkflow(tenantId);
  }

  static async updateWorkflow(tenantId, workflow) {
    await WorkflowModel.updateOne({ tenantId }, workflow);

    return await WorkflowManager.getWorkflow(tenantId);
  }

  static async updateTasks(tenantId, workflowId, tasks) {
    await WorkflowModel.updateOne(
      { tenantId, _id: workflowId },
      { states: tasks },
    );
  }

  static async archiveTask(tenantId, workflowId, archive) {
    await WorkflowModel.updateOne({ tenantId, _id: workflowId }, { archive });
  }

  static async removeTaskFromArchive(tenantId, workflowId, taskId) {
    const workflow = await WorkflowModel.updateOne(
      { tenantId, _id: workflowId },
      { $pull: { archive: { id: taskId } } },
    );
  }
}

async function createWorkflowFromModel(workflowModel, metaData = true) {
  const id = workflowModel._id.valueOf();
  const workflow = new Workflow({ id, ...workflowModel._doc });
  if (!metaData) {
    delete workflow.id;
    delete workflow.name;
    delete workflow.description;
    delete workflow.tenantId;
  }
  return workflow;
}

async function createStatusFromModel(statusModel, tenantId) {
  for (const status of statusModel) {
    status.tasks = await Promise.all(
      status.tasks.map(async (task) => {
        return {
          ...task,
          bookingItem: await BookingManager.getBooking(task.id, tenantId),
        };
      }),
    );
  }
  return statusModel;
}

module.exports = WorkflowManager;
