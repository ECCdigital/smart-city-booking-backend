module.exports = {
  name: "05-06-2023-transfer-defaultState-to-onCreate",

  up: async function (mongoose) {
    const Workflow = mongoose.model("Workflow");
    const workflows = await Workflow.find({}).lean();

    for (const workflow of workflows) {
      if (workflow.defaultState !== undefined) {
        workflow.onCreate = workflow.defaultState;

        await Workflow.collection.updateOne(
          { _id: workflow._id },
          {
            $set: { onCreate: workflow.defaultState, onCommit: "" , onReject: "", onPaid: "" },
            $unset: { defaultState: "" },
          },
          { runValidators: false, strict: false },
        );
      }
    }
  },

  down: async function (mongoose) {
    const Workflow = mongoose.model("Workflow");
    const workflows = await Workflow.find({}).lean();

    for (const workflow of workflows) {
      if (workflow.onCreate !== undefined) {
        workflow.defaultState = workflow.onCreate;

        await Workflow.collection.updateOne(
          { _id: workflow._id },
          {
            $set: { defaultState: workflow.onCreate },
          },
        );
      }
    }
  },
};
