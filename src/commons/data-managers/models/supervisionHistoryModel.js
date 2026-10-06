const mongoose = require("mongoose");
const {
  supervisionHistorySchemaDefinition,
} = require("../../schemas/supervisionHistorySchema");

const { Schema } = mongoose;

const SupervisionHistorySchema = new Schema(supervisionHistorySchemaDefinition);

SupervisionHistorySchema.index({ tenantId: 1, occurredAt: -1 });
SupervisionHistorySchema.index({ occurredAt: -1 });
SupervisionHistorySchema.index(
  { dedupeKey: 1 },
  { unique: true, sparse: true },
);

module.exports =
  mongoose.models.SupervisionHistory ||
  mongoose.model("SupervisionHistory", SupervisionHistorySchema);
