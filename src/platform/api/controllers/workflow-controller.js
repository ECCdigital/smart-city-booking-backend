const WorkflowManager = require("../../../commons/data-managers/workflow-manager");

class WorkflowController {
  static async getWorkflow(req, res) {
    const tenantId = req.params.tenant;
    const workflow = await WorkflowManager.getWorkflow(tenantId);
    res.status(200).send(workflow);
  }

  static async updateTask(req, res) {
    const {
      params: { tenant: tenantId },
      query: { taskId, origin, destination },
    } = req;
    console.log(tenantId, taskId, origin, destination);
    const workflow = await WorkflowManager.getWorkflow(tenantId);
    res.status(200).send(workflow);
  }
}

module.exports = WorkflowController;
