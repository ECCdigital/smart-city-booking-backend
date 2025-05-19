const mongoose = require("mongoose");
const Tenant = require("../../entities/tenant");
const SecurityUtils = require("../../utilities/security-utils");
const PaymentApplication = require("../../entities/application/paymentApplication");
const AuthApplication = require("../../entities/application/authApplication");
const LockerApplication = require("../../entities/application/lockerApplication");
const { Schema } = mongoose;

const TenantSchema = new Schema(Tenant.schema);

TenantSchema.pre("updateOne", async function (next) {
  const update = this.getUpdate();

  update.noreplyPassword = SecurityUtils.encrypt(update.noreplyPassword);

  update.noreplyGraphClientSecret = SecurityUtils.encrypt(
    update.noreplyGraphClientSecret,
  );

  update.applications = encryptApps(update);

  next();
});

TenantSchema.pre("replaceOne", async function (next) {
  const update = this.getUpdate();

  update.noreplyPassword = SecurityUtils.encrypt(update.noreplyPassword);

  update.noreplyGraphClientSecret = SecurityUtils.encrypt(
    update.noreplyGraphClientSecret,
  );

  update.applications = encryptApps(update);

  next();
});

TenantSchema.pre("save", async function (next) {
  this.noreplyPassword = SecurityUtils.encrypt(this.noreplyPassword);
  this.noreplyGraphClientSecret = SecurityUtils.encrypt(
    this.noreplyGraphClientSecret,
  );

  this.applications = encryptApps(this);

  next();
});

TenantSchema.post("init", function (doc) {
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

function decryptApps(tenant) {
  return tenant.applications?.map((app) => {
    let appClass;
    if (app.type === "payment") {
      appClass = new PaymentApplication(app);
    } else if (app.type === "auth") {
      appClass = new AuthApplication(app);
    } else if (app.type === "locker") {
      appClass = new LockerApplication(app);
    }
    appClass.decrypt();
    return appClass;
  });
}

function encryptApps(tenant) {
  return tenant.applications?.map((app) => {
    let appClass;
    if (app.type === "payment") {
      appClass = new PaymentApplication(app);
    } else if (app.type === "auth") {
      appClass = new AuthApplication(app);
    } else if (app.type === "locker") {
      appClass = new LockerApplication(app);
    }
    appClass.encrypt();
    return appClass;
  });
}

module.exports =
  mongoose.models.Tenant || mongoose.model("Tenant", TenantSchema);
