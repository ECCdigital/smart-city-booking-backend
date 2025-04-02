module.exports = {
  name: "20-03-2025-rework-workflow-actions",

  up: async function (mongoose) {
    const Workflow = mongoose.model("Workflow");
    const workflows = await Workflow.find({});

    for (const workflow of workflows) {
      for (const state of workflow.states) {
        for (const action of state.actions) {
          if (action.type === "email" && action.receiverType === undefined) {
            action.receiverType = "user";
          }
        }
      }

      await Workflow.collection.updateOne(
        { _id: workflow._id },
        { $set: { states: workflow.states } },
      );
    }
  },

  down: async function (mongoose) {
    const Workflow = mongoose.model("Workflow");
    const workflows = await Workflow.find({});

    for (const workflow of workflows) {
      for (const state of workflow.states) {
        for (const action of state.actions) {
          if (action.type === "email" && action.receiverType === "user") {
            delete action.receiverType;
          }
        }
      }
      await Workflow.collection.updateOne(
        { _id: workflow._id },
        { $set: { states: workflow.states } },
      );
    }
  },
};
