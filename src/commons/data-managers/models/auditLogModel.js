const mongoose = require("mongoose");
const auditLogSchemaDefinition = require("../../schemas/auditLogSchema");

const { Schema } = mongoose;

const AuditLogSchema = new Schema(auditLogSchemaDefinition);

AuditLogSchema.index({ tenantId: 1, createdAt: -1 });

module.exports =
  mongoose.models.AuditLog ||
  mongoose.model("AuditLog", AuditLogSchema, "audit_log");
