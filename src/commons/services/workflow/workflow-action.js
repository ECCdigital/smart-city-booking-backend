const MailController = require("../../mail-service/mail-controller");
const BookingManager = require("../../data-managers/booking-manager");
const MembershipManager = require("../../data-managers/membership-manager");
const { TRIGGER } = require("../booking-lifecycle/booking-state");

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
    if (!this._action.sendTo) return;

    const receivers = new Set();

    if (this._action.receiverType === "user") {
      for (const user of this._action.sendTo) {
        receivers.add(user);
      }
    }

    if (this._action.receiverType === "role") {
      for (const role of this._action.sendTo) {
        const users = await MembershipManager.getMembershipsByTenantAndRoles(
          this.tenantId,
          [role],
        );
        for (const user of users) {
          receivers.add(user.userId);
        }
      }
    }

    for (const receiver of receivers) {
      await MailController.sendWorkflowNotification({
        sendTo: receiver,
        tenantId: this.tenantId,
        bookingId: this.taskId,
        oldStatus: this.sourceStatus,
        newStatus: this.destinationStatus,
      });
    }
  }
}

class BookingStatusAction extends WorkflowAction {
  constructor(action, bookingId, tenantId) {
    super(action);
    this.bookingId = bookingId;
    this.tenantId = tenantId;
  }

  async execute() {
    if (!this._action.bookingStatus) return;

    const booking = await BookingManager.getBooking(
      this.bookingId,
      this.tenantId,
    );

    if (!booking) return;

    // The transitions a workflow action sets off run without their own
    // workflow event (glossary "Auslöser": `workflow`), so a state change
    // never loops back into the workflow.
    const { bookingLifecycle } = require("../booking-lifecycle");
    const options = { trigger: TRIGGER.WORKFLOW };

    for (const bs of this._action.bookingStatus) {
      if (bs === "commit") {
        await bookingLifecycle.confirm(this.tenantId, this.bookingId, options);
      }
      if (bs === "paid") {
        await bookingLifecycle.pay(this.tenantId, this.bookingId, options);
      }
      if (bs === "reject") {
        await bookingLifecycle.cancel(this.tenantId, this.bookingId, options);
      }
    }
  }
}

module.exports = { WorkflowAction, EmailAction, BookingStatusAction };
