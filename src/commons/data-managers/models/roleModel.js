const mongoose = require("mongoose");
const { Role } = require("../../entities/role");
const { Schema } = mongoose;

const RoleSchema = new Schema(Role.schema);

RoleSchema.index({ id: 1, tenantId: 1 }, { unique: true });

RoleSchema.pre("validate", function (next) {
  if (Array.isArray(this.adminInterfaces)) {
    const allowedValues = this.schema.path("adminInterfaces").caster.enumValues;
    this.adminInterfaces = this.adminInterfaces.filter((value) =>
      allowedValues.includes(value),
    );
  }
  next();
});
module.exports = mongoose.models.Role || mongoose.model("Role", RoleSchema);
