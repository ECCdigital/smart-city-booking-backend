const mongoose = require("mongoose");
const SecurityUtils = require("../../utilities/security-utils");
const Instance = require("../../entities/instance");
const SsoApplication = require("../../entities/application/ssoApplication");

const { Schema } = mongoose;
const InstanceSchema = new Schema(Instance.schema);

InstanceSchema.pre("save", async function (next) {
  if (this.isModified("noreplyPassword"))
    this.noreplyPassword = SecurityUtils.encrypt(this.noreplyPassword);
  if (this.isModified("noreplyGraphClientSecret"))
    this.noreplyGraphClientSecret = SecurityUtils.encrypt(
      this.noreplyGraphClientSecret,
    );
  this.applications = encryptApps(this);

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

  doc.applications = decryptApps(doc);
});

function decryptApps(instance) {
  return instance.applications.map((app) => {
    let appClass;
    if (app?.type === "auth") {
      appClass = SsoApplication.init(app);
    }
    appClass?.decrypt();
    return appClass;
  });
}

function encryptApps(instance) {
  return instance.applications.map((app) => {
    let appClass;
    if (app?.type === "auth") {
      appClass = SsoApplication.init(app);
    }

    appClass?.encrypt();
    return appClass;
  });
}

module.exports =
  mongoose.models.Instance || mongoose.model("Instance", InstanceSchema);
