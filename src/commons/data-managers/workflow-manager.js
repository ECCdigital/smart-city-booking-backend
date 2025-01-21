const dbm = require("../utilities/database-manager");
const Workflow = require("../entities/Workflow");
const BookingManager = require("./booking-manager");

class WorkflowManager {
  static async getWorkflow(tenantId) {
    try {
      const workflowModel = await dbm
        .get()
        .collection("workflows")
        .findOne({ tenant: tenantId });
      if (!workflowModel) return null;
      return await createWorkflowFromModel(workflowModel);
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  static async getWorkflowStates(tenantId) {
    try {
      const workflowModel = await dbm
        .get()
        .collection("workflows")
        .findOne({ tenant: tenantId });
      if (!workflowModel) return null;
      return await createWorkflowFromModel(workflowModel);
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  static async getTasks(tenantId, populate = false) {
    try {
      const workflowModel = await dbm
        .get()
        .collection("workflows")
        .findOne({ tenant: tenantId });
      if (!workflowModel) return null;
      return await createStatusFromModel(
        workflowModel.states,
        tenantId,
        populate,
      );
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  static async createWorkflow({
    tenant,
    name,
    description,
    states,
    archive,
    active,
  }) {
    try {
      await dbm
        .get()
        .collection("workflows")
        .insertOne({ tenant, name, description, states, archive, active });
      return await WorkflowManager.getWorkflow(tenant);
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  static async updateWorkflow(
    tenantId,
    { tenant, name, description, states, archive, active },
  ) {
    try {
      await dbm
        .get()
        .collection("workflows")
        .updateOne(
          { tenant: tenantId },
          { $set: { tenant, name, description, states, archive, active } },
          { upsert: true },
        );
      return await WorkflowManager.getWorkflow(tenantId);
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  static async updateTasks(tenantId, workflowId, tasks) {
    try {
      await dbm
        .get()
        .collection("workflows")
        .updateOne(
          { tenant: tenantId, _id: workflowId },
          { $set: { states: tasks } },
        );
    } catch (error) {
      console.error(error);
    }
  }

  static async archiveTask(tenantId, workflowId, archive) {
    try {
      await dbm
        .get()
        .collection("workflows")
        .updateOne(
          { tenant: tenantId, _id: workflowId },
          { $set: { archive: archive } },
        );
    } catch (error) {
      console.error(error);
    }
  }
}

async function createWorkflowFromModel(workflowModel, metaData = true) {
  const id = workflowModel._id.valueOf();
  const workflow = new Workflow({ id, ...workflowModel });
  if (!metaData) {
    delete workflow.id;
    delete workflow.name;
    delete workflow.description;
    delete workflow.tenant;
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
