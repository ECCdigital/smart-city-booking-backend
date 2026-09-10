const adminUserSchemaDefinition = require("../../schemas/adminUserSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class AdminUser {
  constructor(params = {}) {
    Object.assign(this, SchemaUtils.createDefaults(adminUserSchemaDefinition));

    Object.keys(adminUserSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, adminUserSchemaDefinition);
  }

  static create(params) {
    const adminUser = new AdminUser(params);
    adminUser.validate();
    return adminUser;
  }
}

module.exports = AdminUser;
