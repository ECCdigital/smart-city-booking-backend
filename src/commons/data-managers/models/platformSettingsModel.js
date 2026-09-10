const mongoose = require("mongoose");
const platformSettingsSchemaDefinition = require("../../schemas/platformSettingsSchema");

const { Schema } = mongoose;

const PlatformSettingsSchema = new Schema(platformSettingsSchemaDefinition);

PlatformSettingsSchema.methods.toEntity = function () {
  const PlatformSettings = require("../../entities/settings/platformSettings");
  return new PlatformSettings(this.toObject());
};

module.exports =
  mongoose.models.PlatformSettings ||
  mongoose.model(
    "PlatformSettings",
    PlatformSettingsSchema,
    "platform_settings",
  );
