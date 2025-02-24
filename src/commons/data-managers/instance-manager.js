const Instance = require("../entities/instance");
const InstanceModel = require("./models/instanceModel");

class InstanceManager {
  static async getInstance() {
    const rawInstance = await InstanceModel.findOne();
    if (!rawInstance) {
      return null;
    }

    return new Instance(rawInstance);
  }

  static async updateInstance(instance) {
    const rawInstance = await InstanceModel.findOne();
    if (!rawInstance) {
      return null;
    }
    rawInstance.set(instance);
    await rawInstance.save();
    return new Instance(rawInstance);
  }
}

module.exports = InstanceManager;
