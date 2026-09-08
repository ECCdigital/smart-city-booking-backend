const mongoose = require("mongoose");
const { accessLogSchemaDefinition } = require("../../schemas/accessLogSchema");

const { Schema } = mongoose;

const AccessLogSchema = new Schema(accessLogSchemaDefinition);

AccessLogSchema.index({ tenantId: 1, bookingId: 1 });
AccessLogSchema.index({ tenantId: 1, accessPointId: 1 });
AccessLogSchema.index({ timestamp: 1 });
AccessLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.AccessLog || mongoose.model("AccessLog", AccessLogSchema);
