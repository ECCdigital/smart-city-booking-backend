const BookingManager = require("../../data-managers/booking-manager");
const WorkflowManager = require("../../data-managers/workflow-manager");
const { EmailAction, BookingStatusAction } = require("./workflow-action");

class WorkflowService {
  static async updateWorkflow(tenantId, workflow) {
    const currentWorkflow = await WorkflowManager.getWorkflow(tenantId);

    if (!currentWorkflow) {
      return;
    }
    const statesMap = new Map(currentWorkflow.states.map((s) => [s.id, s]));

    const newStates = workflow.states.map((newState) => {
      const existingState = statesMap.get(newState.id);
      return {
        id: newState.id,
        name: newState.name,
        actions: newState.actions || [],
        tasks: existingState ? existingState.tasks : [],
      };
    });

    Object.assign(currentWorkflow, {
      defaultState: workflow.defaultState,
      active: workflow.active,
      description: workflow.description,
      name: workflow.name,
      states: newStates,
    });

    return await WorkflowManager.updateWorkflow(tenantId, currentWorkflow);
  }

  static async updateTask(tenantId, taskId, destination, newIndex) {
    const workflow = await WorkflowManager.getWorkflow(tenantId);

    if (!workflow || !workflow.states) {
      return;
    }

    const fromStatus = workflow?.states.find((status) =>
      status.tasks.some((task) => task.id === taskId),
    );

    if (destination === "archive") {
      return await WorkflowService.archiveTask(tenantId, taskId);
    }

    if (fromStatus) {
      moveTask(workflow.states, fromStatus.id, destination, taskId, newIndex);
      await WorkflowManager.updateTasks(tenantId, workflow.id, workflow.states);
      if (fromStatus.id !== destination) {
        action(workflow.states, fromStatus.id, destination, taskId, tenantId);
      }
    } else {
      const booking = await BookingManager.getBooking(taskId, tenantId);
      if (!booking) {
        throw new Error("Booking not found");
      }
      addTask(workflow.states, destination, taskId, newIndex);
      await WorkflowManager.updateTasks(tenantId, workflow.id, workflow.states);
      await WorkflowManager.removeTaskFromArchive(
        tenantId,
        workflow.id,
        taskId,
      );
      action(workflow.states, fromStatus?.id, destination, taskId, tenantId);
    }
    return await WorkflowManager.getWorkflow(tenantId, true);
  }

  static async archiveTask(tenantId, taskId) {
    const workflow = await WorkflowManager.getWorkflow(tenantId);

    if (!workflow || !workflow.states) {
      return;
    }

    const fromAction = workflow.states.find((status) =>
      status.tasks.find((task) => task.id === taskId),
    );

    archiveTask(workflow.states, workflow.archive, fromAction?.id, taskId);
    await WorkflowManager.updateTasks(tenantId, workflow.id, workflow.states);
    await WorkflowManager.archiveTask(tenantId, workflow.id, workflow.archive);

    return await WorkflowManager.getWorkflow(tenantId, true);
  }

  static async removeTask(tenantId, taskId) {
    const workflow = await WorkflowManager.getWorkflow(tenantId);

    if (!workflow || !workflow.states) {
      return;
    }

    removeTask(workflow.states, taskId);

    await WorkflowManager.updateTasks(tenantId, workflow.id, workflow.states);
    return await WorkflowManager.getWorkflow(tenantId, true);
  }

  static async getBacklog(tenantId) {
    const workflow = await WorkflowManager.getWorkflow(tenantId);

    if (!workflow || !workflow.active) {
      return [];
    }

    const trackedBookings = [];

    for (const status of workflow.states) {
      for (const task of status.tasks) {
        trackedBookings.push(task.id);
      }
    }

    for (const booking of workflow.archive) {
      trackedBookings.push(booking.id);
    }

    const rawBacklog = await BookingManager.getBookingsCustomFilter(tenantId, {
      id: { $nin: trackedBookings },
    });

    return rawBacklog.map((booking) => {
      return {
        id: booking.id,
        added: null,
      };
    });
  }

  static async getWorkflowStatus(tenantId, bookingID) {
    const workflow = await WorkflowManager.getWorkflow(tenantId);

    if (!workflow || !workflow.active) return null;

    const status = workflow.states.find((status) =>
      status.tasks.some((task) => task.id === bookingID),
    );

    let archive;
    if (!status) {
      archive = workflow.archive.some((task) => task.id === bookingID)
        ? "archive"
        : "";
    }
    return status?.id || archive || null;
  }
}

module.exports = WorkflowService;

function moveTask(
  statusList,
  sourceStatusId,
  destinationStatusId,
  taskId,
  position,
) {
  if (position === null || position === undefined) {
    return;
  }
  const sourceStatus = statusList.find((s) => s.id === sourceStatusId);
  const destinationStatus = statusList.find(
    (s) => s.id === destinationStatusId,
  );

  const task = sourceStatus.tasks.find((task) => task.id === taskId);

  if (!task) {
    return;
  }

  if (sourceStatusId !== destinationStatusId) {
    task.added = Date.now();
  }

  const taskIndex = sourceStatus.tasks.indexOf(task);
  if (taskIndex === -1) {
    return;
  }

  if (sourceStatus) {
    sourceStatus.tasks.splice(taskIndex, 1);
  }

  if (destinationStatus) {
    destinationStatus.tasks.splice(position, 0, {
      id: task.id,
      added: task.added,
    });
  }
}

function addTask(statusList, destinationStatusId, taskId, position) {
  const destinationStatus = statusList.find(
    (s) => s.id === destinationStatusId,
  );

  if (!destinationStatus) {
    return;
  }

  destinationStatus.tasks.splice(position, 0, {
    id: taskId,
    added: Date.now(),
  });
}

function action(
  statusList,
  fromStatusId,
  destinationStatusId,
  taskId,
  tenantId,
) {
  const sourceStatus = statusList.find((s) => s.id === fromStatusId);

  const destinationStatus = statusList.find(
    (s) => s.id === destinationStatusId,
  );

  if (!destinationStatus) {
    return;
  }

  destinationStatus.actions.forEach((action) => {
    let actionClass;
    if (action.type === "email") {
      actionClass = new EmailAction(
        action,
        sourceStatus?.name || "Backlog",
        destinationStatus.name,
        taskId,
        tenantId,
      );
    }
    if (action.type === "bookingStatus") {
      actionClass = new BookingStatusAction(action, taskId, tenantId);
    }
    actionClass.execute();
  });
}

function archiveTask(statusList, archive, sourceStatusId, taskId) {
  if (sourceStatusId) {
    const sourceStatus = statusList.find((s) => s.id === sourceStatusId);

    const task = sourceStatus.tasks.find((task) => task.id === taskId);

    if (!task) {
      return;
    }

    const taskIndex = sourceStatus.tasks.indexOf(task);
    if (taskIndex === -1) {
      return;
    }

    sourceStatus.tasks.splice(taskIndex, 1);
  }

  if (archive.find((task) => task.id === taskId)) {
    return;
  }

  archive.push({ id: taskId, added: Date.now() });
}

function removeTask(statusList, taskId) {
  const sourceStatus = statusList.find((status) =>
    status.tasks.find((task) => task.id === taskId),
  );

  if (sourceStatus) {
    const taskIndex = sourceStatus.tasks.findIndex(
      (task) => task.id === taskId,
    );
    sourceStatus.tasks.splice(taskIndex, 1);
  }
}
