const mongoose = require("mongoose");
const { roleSchemaDefinition } = require("../../schemas/roleSchema");
const { Schema } = mongoose;

const RoleSchema = new Schema(roleSchemaDefinition);

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

RoleSchema.methods.toEntity = function () {
  const { Role } = require("../../entities/role/role");
  return new Role(this.toObject());
};

module.exports = mongoose.models.Role || mongoose.model("Role", RoleSchema);
