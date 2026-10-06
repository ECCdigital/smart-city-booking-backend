const mongoose = require("mongoose");
const {
  supervisionNotificationSchemaDefinition,
} = require("../../schemas/supervisionNotificationSchema");

const { Schema } = mongoose;

const SupervisionNotificationSchema = new Schema(
  supervisionNotificationSchemaDefinition,
);

SupervisionNotificationSchema.index({ status: 1, createdAt: 1 });
SupervisionNotificationSchema.index(
  { dedupeKey: 1 },
  { unique: true, sparse: true },
);

module.exports =
  mongoose.models.SupervisionNotification ||
  mongoose.model("SupervisionNotification", SupervisionNotificationSchema);
