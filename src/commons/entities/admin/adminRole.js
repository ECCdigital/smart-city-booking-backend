const adminRoleSchemaDefinition = require("../../schemas/adminRoleSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class AdminRole {
  constructor(params = {}) {
    Object.assign(this, SchemaUtils.createDefaults(adminRoleSchemaDefinition));

    Object.keys(adminRoleSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, adminRoleSchemaDefinition);
  }

  static create(params) {
    const role = new AdminRole(params);
    role.validate();
    return role;
  }
}

module.exports = AdminRole;
