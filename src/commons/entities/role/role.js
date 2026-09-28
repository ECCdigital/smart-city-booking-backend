const { v4: uuidv4 } = require("uuid");
const SchemaUtils = require("../../utilities/schemaUtils");
const { roleSchemaDefinition } = require("../../schemas/roleSchema");
const { ROLE_GROUPS, ROLE_LEVELS } = require("./role-catalogue");

/**
 * The Role class is the basic definition for the security layer.
 */
class Role {
  /**
   * Create a new role object.
   * @param {Object} params Role parameters
   */
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(roleSchemaDefinition);
    Object.assign(this, defaults, params);
  }

  /**
   * Export public role information
   * @returns {Object} Public role data
   */
  toPublic() {
    return {
      id: this.id,
      name: this.name,
      tenantId: this.tenantId,
    };
  }

  /**
   * Validate the role
   * @returns {boolean} True if valid
   */
  validate() {
    SchemaUtils.validate(this, roleSchemaDefinition);
    return true;
  }

  /**
   * Create a new role
   * @param {Object} params Role parameters
   * @returns {Role} The created role
   */
  static create(params) {
    const role = new Role({
      id: params.id || uuidv4(),
      ...params,
    });
    role.validate();
    return role;
  }
}

module.exports = {
  Role,
  ROLE_GROUPS,
  ROLE_LEVELS,
};
