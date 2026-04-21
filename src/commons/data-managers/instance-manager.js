const Instance = require("../entities/instance/instance");
const InstanceModel = require("./models/instanceModel");
const {
  CustomFieldCache,
} = require("../services/custom-field/custom-field-cache");

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

    CustomFieldCache.invalidateInstance();

    return updated.toEntity();
  }

  static async getBookableCustomFields() {
    const rawInstance = await InstanceModel.findOne();
    if (!rawInstance) {
      return [];
    }
    return rawInstance.bookableCustomFields || [];
  }
}

module.exports = InstanceManager;
