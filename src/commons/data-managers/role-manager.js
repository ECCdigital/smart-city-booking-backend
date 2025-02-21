const { Role } = require("../entities/role");

const mongoose = require("mongoose");
const { Schema } = mongoose;

const RoleSchema = new Schema(Role.schema());

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
const RoleModel = mongoose.models.Role || mongoose.model("Role", RoleSchema);

/**
 * Data Manager for role objects. Role objects determine the permissions for users.
 *
 * @author Lennard Scheffler, lennard.scheffler@e-c-crew.de
 */
class RoleManager {
  /**
   * Get all roles
   * @returns List of bookings
   */
  static async getRoles(tenantId) {
    const rawRoles = await RoleModel.find({ tenantId: tenantId });
    return rawRoles.map((rr) => {
      return new Role(rr);
    });
  }

  /**
   * Get a specific role object from the database.
   *
   * @param {string} id Logical identifier of the role object
   * @param {string} tenantId The tenant id
   * @returns A single role object
   */
  static async getRole(id, tenantId) {
    const rawRole = await RoleModel.findOne({ id: id, tenantId: tenantId });
    if (!rawRole) return null;
    return new Role(rawRole);
  }

  /**
   * Insert a role object into the database or update it.
   *
   * @param {Role} role The role object to be stored.
   * @param {string} tenantId The tenant id
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns Promise<>
   */
  static async storeRole(role, tenantId, upsert = true) {
    await RoleModel.findOneAndUpdate(
      { id: role.id, tenantId: tenantId },
      role,
      {
        upsert: upsert,
      },
    );
  }

  /**
   * Remove a role object from the database.
   *
   * @param {string} id Logical identifier of the role object
   * @param {string} tenantId The tenant id
   * @returns Promise<>
   */
  static async removeRole(id, tenantId) {
    await RoleModel.deleteOne({ id: id, tenantId: tenantId });
  }
}

module.exports = { RoleManager, RoleModel };
