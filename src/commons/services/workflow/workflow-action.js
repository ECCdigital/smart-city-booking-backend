const MailController = require("../../mail-service/mail-controller");
const TenantManager = require("../../data-managers/tenant-manager");
const BookingManager = require("../../data-managers/booking-manager");
const MembershipManager = require("../../data-managers/membership-manager");

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

    const bookingService = require("../../services/checkout/booking-service");

    for (const bs of this._action.bookingStatus) {
      if (bs === "commit") {
        console.log("Committing booking as part of workflow action");
        await bookingService.commitBooking(
          this.tenantId,
          {
            id: this.bookingId,
          },
          true,
        );
      }
      if (bs === "paid") {
        console.log("Setting booking as paid as part of workflow action");
        await bookingService.setBookingPayed({
          tenantId: this.tenantId,
          bookingId: this.bookingId,
          skipWorkflow: true,
        });
      }
      if (bs === "reject") {
        console.log("Rejecting booking as part of workflow action");
        await bookingService.rejectBooking(
          this.tenantId,
          this.bookingId,
          "",
          null,
          true,
        );
      }
    }
  }
}

module.exports = { WorkflowAction, EmailAction, BookingStatusAction };
