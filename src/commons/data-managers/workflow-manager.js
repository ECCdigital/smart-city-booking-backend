const dbm = require("../utilities/database-manager");
const Workflow = require("../entities/Workflow");

class WorkflowManager {
  static async getWorkflow(tenantId) {
    try {
      const workflowModel = await dbm
        .get()
        .collection("workflows")
        .findOne({ tenant: tenantId });
      if (!workflowModel) return null;
      return createWorkflowFromModel(workflowModel);
    } catch (error) {
      console.error(error);
      return null;
    }
  }
}

function createWorkflowFromModel(workflowModel) {
  const id = workflowModel._id.valueOf();
  return new Workflow({ id, ...workflowModel });
}

module.exports = WorkflowManager;
