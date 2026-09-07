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

    const exported = publicFields.reduce((result, field) => {
      if (this[field] !== undefined) {
        result[field] = this[field];
      }
      return result;
    }, {});
    exported.accessApps = this._exportPublicAccessApps();
    return exported;
  }

  /**
   * The customer-service contact of every access application that has one
   * (glossary "Notfallhilfe"), for the storefront's emergency help. Each
   * entry is built key by key - an application carries its provider's
   * credentials, and nothing of it leaves but what is named here.
   *
   * @returns {Array<{ id: string, customerService: { name, phone, email } }>}
   */
  _exportPublicAccessApps() {
    return (this.applications || [])
      .filter(
        (app) =>
          app.type === "access" && app.active === true && app.customerService,
      )
      .map((app) => ({
        id: app.id,
        customerService: {
          name: app.customerService.name,
          phone: app.customerService.phone,
          email: app.customerService.email,
        },
      }));
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
