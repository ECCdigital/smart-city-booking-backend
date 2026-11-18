const mongoose = require("mongoose");
const {
  blacklistEntrySchemaDefinition,
} = require("../../schemas/blacklistEntrySchema");

const { Schema } = mongoose;

const BlacklistEntrySchema = new Schema(blacklistEntrySchemaDefinition);

BlacklistEntrySchema.index({ id: 1 }, { unique: true });
// One entry per address or domain: a second one fails here.
BlacklistEntrySchema.index({ value: 1 }, { unique: true });

module.exports =
  mongoose.models.BlacklistEntry ||
  mongoose.model("BlacklistEntry", BlacklistEntrySchema, "blacklist");
