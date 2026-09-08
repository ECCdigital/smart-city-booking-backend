const { instanceSchemaDefinition } = require("../../schemas/instanceSchema");
const SchemaUtils = require("../../utilities/schemaUtils");
const { exportInstanceMedia } = require("../../services/media/instance-media");

class Instance {
  /**
   * Create a new instance object.
   * @param {Object} params Instance parameters
   */
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(instanceSchemaDefinition);
    Object.assign(this, defaults, params);
  }

  /**
   * Remove private data from the instance
   */
  removePrivateData() {
    this.applications = this.applications.map((a) => {
      a?.removePrivateData();
      return a;
    });
    delete this.mailTemplate;
    delete this.mailAddress;
    delete this.noreplyMail;
    delete this.noreplyDisplayName;
    delete this.noreplyHost;
    delete this.noreplyPort;
    delete this.noreplyUser;
    delete this.noreplyPassword;
    delete this.noreplyStarttls;
    delete this.noreplyUseGraphApi;
    delete this.noreplyGraphTenantId;
    delete this.noreplyGraphClientId;
    delete this.noreplyGraphClientSecret;
    delete this.ownerUserIds;
    delete this.mailEnabled;
    delete this.isInitialized;
    delete this.allowedUsersToCreateTenant;
    delete this.allowAllUsersToCreateTenant;
    delete this.bookableCustomFields;
  }

  /**
   * The instance as it goes out: every media reference enriched with the URL
   * it resolves to, and the legacy read fields (`branding.logoUrl`, the `url`
   * of each legal document) derived from them (§4.9). What is stored stays
   * untouched — the derivation happens on the way out only.
   *
   * @returns {Object} The instance as it goes out.
   */
  exportWithMedia() {
    return exportInstanceMedia(this);
  }

  /**
   * Validate the instance
   * @returns {boolean} True if valid
   */
  validate() {
    SchemaUtils.validate(this, instanceSchemaDefinition);
    return true;
  }

  /**
   * Create a new instance
   * @param {Object} params Instance parameters
   * @returns {Instance} The created instance
   */
  static create(params) {
    const instance = new Instance(params);
    instance.validate();
    return instance;
  }
}

module.exports = Instance;
