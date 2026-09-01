const mongoose = require("mongoose");
const { mediaSchemaDefinition } = require("../../schemas/mediaSchema");

const { Schema } = mongoose;

const MediaSchema = new Schema(mediaSchemaDefinition, { timestamps: true });

MediaSchema.index({ id: 1 }, { unique: true });
MediaSchema.index({ tenantId: 1, createdAt: -1 });
MediaSchema.index({ tenantId: 1, kind: 1 });
MediaSchema.index({ tenantId: 1, tags: 1 });
MediaSchema.index({ bookingIds: 1 });
// One legacy file is one medium per tenant (§4.10) — the index only builds
// once the pre-model-change stock is purged (`purge-imported`).
MediaSchema.index(
  { tenantId: 1, legacyPath: 1 },
  {
    unique: true,
    partialFilterExpression: { legacyPath: { $type: "string" } },
  },
);

MediaSchema.methods.toEntity = function () {
  const { Media } = require("../../entities/media/media");
  // Strip the Mongo bookkeeping fields so the entity can be written back as-is.
  const plain = this.toObject();
  delete plain._id;
  delete plain.__v;
  return new Media(plain);
};

module.exports = mongoose.models.Media || mongoose.model("Media", MediaSchema);
