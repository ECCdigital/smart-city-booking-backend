const Instance = require("../entities/instance/instance");
const InstanceModel = require("./models/instanceModel");

class InstanceManager {
  static async getInstance() {
    const rawInstance = await InstanceModel.findOne();
    if (!rawInstance) {
      return null;
    }

    return rawInstance.toEntity();
  }

  static async updateInstance(instance) {
    const instanceEntity =
      instance instanceof Instance ? instance : new Instance(instance);

    instanceEntity.validate();

    const rawInstance = await InstanceModel.findOne();
    if (!rawInstance) {
      return null;
    }
    const updated = await InstanceModel.findOneAndUpdate(
      {},
      { $set: instanceEntity },
      { new: true },
    );
    return updated.toEntity();
  }

  static async reassignOwnerUserId(previousUserId, newUserId, session = null) {
    const options = session ? { session } : {};
    await InstanceModel.updateOne(
      { ownerUserIds: previousUserId },
      { $set: { "ownerUserIds.$[elem]": newUserId } },
      {
        ...options,
        arrayFilters: [{ elem: previousUserId }],
      },
    );
  }
}

module.exports = InstanceManager;
