const mongoose = require("mongoose");
const tenantSchemaDefinition = require("../../schemas/tenantSchema");
const TenantEncryptionService = require("../../services/tenantEncryptionService");
const { Schema } = mongoose;

const TenantSchema = new Schema(tenantSchemaDefinition);

TenantSchema.pre(["updateOne", "replaceOne"], async function (next) {
  const update = this.getUpdate();
  TenantEncryptionService.encryptInPlace(update);
  next();
});

TenantSchema.pre("save", async function (next) {
  TenantEncryptionService.encryptInPlace(this);
  next();
});

TenantSchema.post("init", function (doc) {
  TenantEncryptionService.decryptInPlace(doc);
});

// Instance method to convert to business entity
TenantSchema.methods.toEntity = function () {
  const Tenant = require("../../entities/tenant/tenant");
  return new Tenant(this.toObject());
};

module.exports =
  mongoose.models.Tenant || mongoose.model("Tenant", TenantSchema);
