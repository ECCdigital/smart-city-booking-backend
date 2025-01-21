const MailController = require("../../mail-service/mail-controller");

class WorkflowAction {
  constructor(action) {
    this._action = action;
  }

  execute() {
    throw new Error("Not implemented");
  }
}

class EmailAction extends WorkflowAction {
  constructor(action, sStatus, dStatus, taskId, tenantId) {
    super(action);
    this.sourceStatus = sStatus;
    this.destinationStatus = dStatus;
    this.taskId = taskId;
    this.tenantId = tenantId;
  }

  async execute() {
    await MailController.sendWorkflowNotification({
      sendTo: this._action.sendTo,
      tenantId: this.tenantId,
      bookingId: this.taskId,
      oldStatus: this.sourceStatus,
      newStatus: this.destinationStatus,
    });
  }
}

module.exports = { WorkflowAction, EmailAction };
