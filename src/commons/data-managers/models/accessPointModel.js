const mongoose = require("mongoose");
const {
  accessPointSchemaDefinition,
} = require("../../schemas/accessPointSchema");

const { Schema } = mongoose;

const AccessPointSchema = new Schema(accessPointSchemaDefinition);

AccessPointSchema.index({ id: 1, tenantId: 1 }, { unique: true });
AccessPointSchema.index({ tenantId: 1, scanCode: 1 }, { unique: true });

AccessPointSchema.methods.toEntity = function () {
  const { AccessPoint } = require("../../entities/access/access-point");
  return new AccessPoint(this.toObject());
};

module.exports =
  mongoose.models.AccessPoint ||
  mongoose.model("AccessPoint", AccessPointSchema);
