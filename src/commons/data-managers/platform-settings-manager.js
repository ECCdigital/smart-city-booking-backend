const PlatformSettings = require("../entities/settings/platformSettings");
const PlatformSettingsModel = require("./models/platformSettingsModel");

class PlatformSettingsManager {
  static async getByTenant(tenantId) {
    const raw = await PlatformSettingsModel.findOne({ tenantId });
    if (!raw) {
      return null;
    }
    return raw.toEntity();
  }

  static async store(settings, upsert = true) {
    const entity =
      settings instanceof PlatformSettings
        ? settings
        : new PlatformSettings(settings);
    entity.validate();
    // pass a copy: Mongoose mutates the update object with $setOnInsert on upsert
    await PlatformSettingsModel.updateOne(
      { tenantId: entity.tenantId },
      { ...entity },
      { upsert },
    );
    return entity;
  }
}

module.exports = PlatformSettingsManager;
