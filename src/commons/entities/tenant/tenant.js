const tenantSchemaDefinition = require("../../schemas/tenantSchema");
const SchemaUtils = require("../../utilities/schemaUtils");
/**
 * Represents a tenant in the system.
 * A tenant is an organization or entity that uses the platform.
 */
class Tenant {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(tenantSchemaDefinition);
    Object.assign(this, defaults);

    Object.keys(tenantSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  exportPublic() {
    const publicFields = [
      "id",
      "name",
      "contactName",
      "location",
      "mail",
      "phone",
      "website",
      "bookableDetailLink",
      "eventDetailLink",
      "defaultEventCreationMode",
      "enablePublicStatusView",
    ];

    return publicFields.reduce((result, field) => {
      if (this[field] !== undefined) {
        result[field] = this[field];
      }
      return result;
    }, {});
  }

  validate() {
    return SchemaUtils.validate(this, tenantSchemaDefinition);
  }

  static create(params) {
    const tenant = new Tenant(params);
    tenant.validate();
    return tenant;
  }
}

module.exports = Tenant;
