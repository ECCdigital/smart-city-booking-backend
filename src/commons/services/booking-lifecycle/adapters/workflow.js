/**
 * The workflow adapter of the booking lifecycle seam: the workflow event of
 * a transition (spec part 2, section 3). Every event runs with
 * `skipBookingStatus`: the lifecycle owns the state, a workflow action
 * calls a transition of its own with `trigger: workflow`.
 */

const WorkflowService = require("../../workflow/workflow-service");

const workflow = {
  /**
   * @param {string} tenantId
   * @param {string} bookingId
   * @param {string} event `onCreate`, `onCommit`, `onPay`, `onReject`
   * @returns {Promise<*>}
   */
  async emit(tenantId, bookingId, event) {
    return await WorkflowService.handleWorkflowEvent(
      tenantId,
      bookingId,
      event,
      true,
    );
  },
};

module.exports = workflow;
