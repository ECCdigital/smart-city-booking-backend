const tenantSchemaDefinition = require("../../schemas/tenantSchema");
const SchemaUtils = require("../../utilities/schemaUtils");
const { exportTenantMedia } = require("../../services/media/tenant-media");
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

  /**
   * The tenant as it goes out to whoever may see all of it: every media
   * reference of its legal documents enriched with the URL it resolves to
   * (spec §6.1). What is stored stays untouched — the derivation happens on the
   * way out only.
   *
   * `exportPublic` is the other export and deliberately unaffected: legal
   * documents are filed and maintained here, not delivered.
   *
   * @returns {Object} The tenant as it goes out.
   */
  exportWithMedia() {
    return exportTenantMedia(this);
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
