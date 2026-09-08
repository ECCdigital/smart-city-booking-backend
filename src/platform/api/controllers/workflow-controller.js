const WorkflowManager = require("../../../commons/data-managers/workflow-manager");
const WorkflowService = require("../../../commons/services/workflow/workflow-service");
const bunyan = require("bunyan");
const Workflow = require("../../../commons/entities/workflow/workflow");

const logger = bunyan.createLogger({
  name: "workflow-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Web Controller for the tenant's workflow. The rights are the router's
 * (`workflow.read`, `workflow.manage`, `workflow.task` of the rights table);
 * the handlers only answer.
 */
class WorkflowController {
  static async getWorkflow(req, res) {
    const tenantId = req.params.tenant;
    const user = req.user;
    try {
      const workflow = await WorkflowManager.getWorkflow(tenantId);

      logger.info(`${tenantId} -- sending workflow to user ${user?.id}`);

      res.status(200).send(workflow);
    } catch (error) {
      logger.error("WorkflowController - getWorkflow: ", error);
      res.status(500).send();
    }
  }

  static async createWorkflow(req, res) {
    const tenantId = req.params.tenant;
    const user = req.user;

    try {
      const workflow = new Workflow(req.body);
      workflow.tenantId = tenantId;
      const createdWorkflow = await WorkflowManager.createWorkflow(
        tenantId,
        workflow,
      );

      logger.info(`${tenantId} -- User ${user?.id} created workflow`);
      res.status(200).send(createdWorkflow);
    } catch (error) {
      logger.error("WorkflowController - createWorkflow: ", error);
      res.status(500).send();
    }
  }

  static async updateWorkflow(req, res) {
    const tenantId = req.params.tenant;
    const user = req.user;
    const workflow = req.body;

    try {
      const updatedWorkflow = await WorkflowService.updateWorkflow(
        tenantId,
        workflow,
      );

      logger.info(`${tenantId} -- User ${user?.id} updated workflow`);
      res.status(200).send(updatedWorkflow);
    } catch (error) {
      logger.error("WorkflowController - updateWorkflow: ", error);
      res.status(500).send();
    }
  }

  static async getWorkflowStates(req, res) {
    const tenantId = req.params.tenant;
    const user = req.user;

    try {
      const states = await WorkflowManager.getWorkflowStates(tenantId);

      logger.info(
        `${tenantId} -- sending workflow, inclusive bookings to user ${user?.id}`,
      );
      res.status(200).send(states);
    } catch (error) {
      logger.error("WorkflowController - getWorkflowStates: ", error);
      res.status(500).send();
    }
  }

  static async updateTask(req, res) {
    try {
      const {
        params: { tenant: tenantId },
        body: { taskId, destination, newIndex },
        user,
      } = req;

      const updatedWorkflow = await WorkflowService.updateTask(
        tenantId,
        taskId,
        destination,
        newIndex,
      );

      logger.info(
        `${tenantId} -- User ${user?.id} updated task ${taskId} to ${destination} at index ${newIndex}`,
      );

      res.status(200).send(updatedWorkflow);
    } catch (error) {
      logger.error("WorkflowController - updateTask: ", error);
      res.status(500).send();
    }
  }

  static async archiveTask(req, res) {
    const {
      params: { tenant: tenantId },
      body: { taskId },
      user,
    } = req;

    try {
      const updatedWorkflow = await WorkflowService.archiveTask(
        tenantId,
        taskId,
      );

      logger.info(`${tenantId} -- User ${user?.id} archived task ${taskId}`);

      res.status(200).send(updatedWorkflow);
    } catch (error) {
      logger.error("WorkflowController - archiveTask: ", error);
      res.status(500).send();
    }
  }

  static async getBacklog(req, res) {
    const {
      params: { tenant: tenantId },
      user,
    } = req;

    try {
      const backlog = await WorkflowService.getBacklog(tenantId);

      logger.info(`${tenantId} -- sending backlog to user ${user?.id}`);

      res.status(200).send(backlog);
    } catch (error) {
      logger.error("WorkflowController - getBacklog: ", error);
      res.status(500).send();
    }
  }
}

module.exports = WorkflowController;
