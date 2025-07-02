const WorkflowManager = require("../../../commons/data-managers/workflow-manager");
const WorkflowService = require("../../../commons/services/workflow/workflow-service");
const bunyan = require("bunyan");
const PermissionsService = require("../../../commons/services/permission-service");
const { RolePermission } = require("../../../commons/entities/role/role");
const PermissionService = require("../../../commons/services/permission-service");
const Workflow = require("../../../commons/entities/workflow/workflow");

const logger = bunyan.createLogger({
  name: "booking-controller.js",
  level: process.env.LOG_LEVEL,
});

class WorkflowController {
  static async getWorkflow(req, res) {
    const tenantId = req.params.tenant;
    const user = req.user;
    try {
      if (
        await PermissionsService._allowReadAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        )
      ) {
        const workflow = await WorkflowManager.getWorkflow(tenantId);

        logger.info(`${tenantId} -- sending workflow to user ${user?.id}`);

        res.status(200).send(workflow);
      } else {
        logger.error(
          `${tenantId} -- User ${user?.id} does not have permission to get workflow`,
        );
        res.status(403).send();
      }
    } catch (error) {
      logger.error("WorkflowController - getWorkflow: ", error);
      res.status(500).send();
    }
  }

  static async createWorkflow(req, res) {
    const tenantId = req.params.tenant;
    const user = req.user;

    try {
      if (
        (await PermissionService._isTenantOwner(user.id, tenantId)) ||
        (await PermissionService._isInstanceOwner(user.id))
      ) {
        const workflow = new Workflow(req.body);
        workflow.tenantId = tenantId;
        const createdWorkflow = await WorkflowManager.createWorkflow(
          tenantId,
          workflow,
        );

        logger.info(`${tenantId} -- User ${user?.id} created workflow`);
        res.status(200).send(createdWorkflow);
      } else {
        logger.error(
          `${tenantId} -- User ${user?.id} does not have permission to create workflow`,
        );
        res.status(403).send();
      }
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
      if (
        (await PermissionService._isTenantOwner(user.id, tenantId)) ||
        (await PermissionService._isInstanceOwner(user.id))
      ) {
        const updatedWorkflow = await WorkflowService.updateWorkflow(
          tenantId,
          workflow,
        );

        logger.info(`${tenantId} -- User ${user?.id} updated workflow`);
        res.status(200).send(updatedWorkflow);
      } else {
        logger.error(
          `${tenantId} -- User ${user?.id} does not have permission to update workflow`,
        );
        res.status(403).send();
      }
    } catch (error) {
      logger.error("WorkflowController - updateWorkflow: ", error);
      res.status(500).send();
    }
  }

  static async getWorkflowStates(req, res) {
    const tenantId = req.params.tenant;
    const user = req.user;

    try {
      if (
        await PermissionsService._allowReadAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        )
      ) {
        const states = await WorkflowManager.getWorkflowStates(tenantId);

        logger.info(
          `${tenantId} -- sending workflow, inclusive bookings to user ${user?.id}`,
        );
        res.status(200).send(states);
      } else {
        logger.error(
          `${tenantId} -- User ${user?.id} does not have permission to get workflow`,
        );
        res.status(403).send();
      }
    } catch (error) {
      logger.error("WorkflowController - getWorkflow: ", error);
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

      if (
        await PermissionsService._allowUpdateAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        )
      ) {
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
      } else {
        logger.error(
          `${tenantId} -- User ${user?.id} does not have permission to update task ${taskId}`,
        );
        res.status(403).send();
      }
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
      if (
        await PermissionsService._allowUpdateAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        )
      ) {
        const updatedWorkflow = await WorkflowService.archiveTask(
          tenantId,
          taskId,
        );

        logger.info(`${tenantId} -- User ${user?.id} archived task ${taskId}`);

        res.status(200).send(updatedWorkflow);
      } else {
        logger.error(
          `${tenantId} -- User ${user?.id} does not have permission to archive task ${taskId}`,
        );
        res.status(403).send();
      }
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
      if (
        await PermissionsService._allowReadAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_BOOKINGS,
        )
      ) {
        const backlog = await WorkflowService.getBacklog(tenantId);

        logger.info(`${tenantId} -- sending backlog to user ${user?.id}`);

        res.status(200).send(backlog);
      } else {
        logger.error(
          `${tenantId} -- User ${user?.id} does not have permission to get backlog`,
        );
        res.status(403).send();
      }
    } catch (error) {
      logger.error("WorkflowController - getBacklog: ", error);
      res.status(500).send();
    }
  }
}

module.exports = WorkflowController;
