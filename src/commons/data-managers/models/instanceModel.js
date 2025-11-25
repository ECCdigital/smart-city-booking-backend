const mongoose = require("mongoose");
const { instanceSchemaDefinition } = require("../../schemas/instanceSchema");
const {
  InstanceEncryptionService,
} = require("../../services/encryptionService");

const { Schema } = mongoose;
const InstanceSchema = new Schema(instanceSchemaDefinition);

InstanceSchema.pre(
  ["updateOne", "replaceOne", "findOneAndUpdate"],
  async function (next) {
    const update = this.getUpdate();
    if (update.$set) {
      InstanceEncryptionService.encrypt(update.$set);
    } else {
      InstanceEncryptionService.encrypt(update);
    }
    next();
  },
);

InstanceSchema.pre("save", async function (next) {
  InstanceEncryptionService.encrypt(this);
  next();
});

InstanceSchema.post("init", function (doc) {
  InstanceEncryptionService.decrypt(doc);
});

InstanceSchema.methods.toEntity = function () {
  const Instance = require("../../entities/instance/instance");
  return new Instance(this.toObject());
};

module.exports =
  mongoose.models.Instance || mongoose.model("Instance", InstanceSchema);
