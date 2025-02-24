const mongoose = require("mongoose");
const SecurityUtils = require("../../utilities/security-utils");
const Instance = require("../../entities/instance");

const { Schema } = mongoose;
const InstanceSchema = new Schema(Instance.schema);

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

module.exports =
  mongoose.models.Instance || mongoose.model("Instance", InstanceSchema);
