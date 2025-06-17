const { Role } = require("../entities/role/role");
const RoleModel = require("./models/roleModel");

/**
 * Data Manager for role objects. Role objects determine the permissions for users.
 *
 * @author Lennard Scheffler, lennard.scheffler@e-c-crew.de
 */
class RoleManager {
  /**
   * Get all roles
   * @returns {Promise<Role[]>} List of roles
   */
  static async getRoles() {
    const rawRoles = await RoleModel.find();
    return rawRoles.map((doc) => doc.toEntity());
  }

  /**
   * Get all tenant roles
   * @param {string} tenantId Tenant ID
   * @returns {Promise<Role[]>} List of tenant roles
   */
  static async getTenantRoles(tenantId) {
    const rawRoles = await RoleModel.find({ tenantId: tenantId });
    return rawRoles.map((doc) => doc.toEntity());
  }

  /**
   * Get a specific role object from the database.
   *
   * @param {string} id Logical identifier of the role object
   * @param {string} tenantId The tenant id
   * @returns {Promise<Role|null>} A single role object or null
   */
  static async getRole(id, tenantId) {
    const rawRole = await RoleModel.findOne({ id: id, tenantId: tenantId });
    if (!rawRole) return null;
    return rawRole.toEntity();
  }

  /**
   * Insert a role object into the database or update it.
   *
   * @param {Role|Object} role The role object to be stored.
   * @param {string} tenantId The tenant id
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns {Promise<Role>} The stored role
   */
  static async storeRole(role, tenantId, upsert = true) {
    const roleEntity = role instanceof Role ? role : new Role(role);
    roleEntity.validate();
    roleEntity.tenantId = tenantId;
    await RoleModel.findOneAndUpdate(
      { id: roleEntity.id, tenantId: tenantId },
      roleEntity,
      {
        upsert: upsert,
      },
    );

    return roleEntity;
  }

  /**
   * Remove a role object from the database.
   *
   * @param {string} id Logical identifier of the role object
   * @param {string} tenantId The tenant id
   * @returns {Promise<void>}
   */
  static async removeRole(id, tenantId) {
    await RoleModel.deleteOne({ id: id, tenantId: tenantId });
  }
}

module.exports = { RoleManager, RoleModel };
