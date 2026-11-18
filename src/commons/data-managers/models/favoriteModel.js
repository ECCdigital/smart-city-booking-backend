const mongoose = require("mongoose");
const { favoriteSchemaDefinition } = require("../../schemas/favoriteSchema");

const { Schema } = mongoose;

const FavoriteSchema = new Schema(favoriteSchemaDefinition);

// One favorite per user and offer: a second mark finds this entry.
FavoriteSchema.index(
  { userId: 1, tenantId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);
// The favorites list reads by user, across tenants.
FavoriteSchema.index({ userId: 1 });

FavoriteSchema.methods.toEntity = function () {
  const { Favorite } = require("../../entities/favorite/favorite");
  return new Favorite(this.toObject());
};

module.exports =
  mongoose.models.Favorite || mongoose.model("Favorite", FavoriteSchema);
