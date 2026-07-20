const mongoose = require("mongoose");
const adminUserSchemaDefinition = require("../../schemas/adminUserSchema");

const { Schema } = mongoose;

const AdminUserSchema = new Schema(adminUserSchemaDefinition);

AdminUserSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

AdminUserSchema.methods.toEntity = function () {
  const AdminUser = require("../../entities/admin/adminUser");
  return new AdminUser(this.toObject());
};

module.exports =
  mongoose.models.AdminUser ||
  mongoose.model("AdminUser", AdminUserSchema, "admin_users");
