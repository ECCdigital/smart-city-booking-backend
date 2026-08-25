const platformSettingsSchemaDefinition = require("../../schemas/platformSettingsSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class PlatformSettings {
  constructor(params = {}) {
    Object.assign(
      this,
      SchemaUtils.createDefaults(platformSettingsSchemaDefinition),
    );

    Object.keys(platformSettingsSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, platformSettingsSchemaDefinition);
  }

  static create(params) {
    const settings = new PlatformSettings(params);
    settings.validate();
    return settings;
  }
}

module.exports = PlatformSettings;
