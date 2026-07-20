const mongoose = require("mongoose");
const applicationSchemaDefinition = require("../../schemas/applicationSchema");

const { Schema } = mongoose;

const ApplicationSchema = new Schema(applicationSchemaDefinition);

ApplicationSchema.index(
  { tenantId: 1, offerId: 1, studentUserId: 1 },
  { unique: true },
);
ApplicationSchema.index({ tenantId: 1, studentUserId: 1 });
ApplicationSchema.index({ tenantId: 1, companyId: 1 });

ApplicationSchema.methods.toEntity = function () {
  const Application = require("../../entities/student/application");
  return new Application(this.toObject());
};

module.exports =
  mongoose.models.Application ||
  mongoose.model("Application", ApplicationSchema, "applications");
