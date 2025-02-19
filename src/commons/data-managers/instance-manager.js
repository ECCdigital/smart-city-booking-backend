const Instance = require("../entities/instance");

const mongoose = require("mongoose");
const SecurityUtils = require("../utilities/security-utils");
const { Schema } = mongoose;
const InstanceSchema = new Schema(Instance.schema());

InstanceSchema.pre("save", async function (next) {
  if (this.isModified("noreplyPassword"))
    this.noreplyPassword = SecurityUtils.encrypt(this.noreplyPassword);
  if (this.isModified("noreplyGraphClientSecret"))
    this.noreplyGraphClientSecret = SecurityUtils.encrypt(
      this.noreplyGraphClientSecret,
    );
  next();
});

InstanceSchema.post("init", function (doc) {
  if (doc.noreplyPassword) {
    doc.noreplyPassword = SecurityUtils.decrypt(doc.noreplyPassword);
  }
  if (doc.noreplyGraphClientSecret) {
    doc.noreplyGraphClientSecret = SecurityUtils.decrypt(
      doc.noreplyGraphClientSecret,
    );
  }
});

const InstanceModel =
  mongoose.models.Instance || mongoose.model("Instance", InstanceSchema);

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
