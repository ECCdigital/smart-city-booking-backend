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
    rawInstance.set(instanceEntity);
    await rawInstance.save();
    const newInstance = await InstanceModel.findOne();
    return newInstance.toEntity();
  }
}

module.exports = InstanceManager;
