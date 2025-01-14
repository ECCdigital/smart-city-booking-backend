import BookingManager from "../../data-managers/booking-manager";

class WorkflowService {
  executeAction(action) {
    let actionClass;
    switch (action.type) {
      case "email":
        actionClass = new EmailAction({ ...action });
        break;
      default:
        throw new Error("Invalid action");
    }
    actionClass.execute();
  }

  async enterState(state, bookingId, tenantId) {
    await BookingManager.storeBooking(
      { id: bookingId, tenantId: tenantId, workflowState },
      false,
    );

    // Execute actions
    for (const action of state.actions) {
      this.executeAction(action);
    }
  }
}
