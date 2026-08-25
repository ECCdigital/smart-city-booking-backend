const mongoose = require("mongoose");
const adminRoleSchemaDefinition = require("../../schemas/adminRoleSchema");

const { Schema } = mongoose;

const AdminRoleSchema = new Schema(adminRoleSchemaDefinition);

AdminRoleSchema.index({ tenantId: 1, id: 1 }, { unique: true });
AdminRoleSchema.index({ tenantId: 1, name: 1 }, { unique: true });

AdminRoleSchema.methods.toEntity = function () {
  const AdminRole = require("../../entities/admin/adminRole");
  return new AdminRole(this.toObject());
};

module.exports =
  mongoose.models.AdminRole ||
  mongoose.model("AdminRole", AdminRoleSchema, "admin_roles");
