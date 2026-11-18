/**
 * A favorite (glossary "Favorit"): a signed-in user's mark on an offer of a
 * tenant, visible to that user alone. The target is the pair of tenant and
 * id, as bookings reference offers; `title` and `tenantName` are a snapshot
 * taken when the mark was set and never refreshed.
 */

const FavoriteTargetType = Object.freeze({
  BOOKABLE: "bookable",
  EVENT: "event",
});

const FAVORITE_TARGET_TYPES = Object.values(FavoriteTargetType);

const isFavoriteTargetType = (value) => FAVORITE_TARGET_TYPES.includes(value);

const favoriteSchemaDefinition = {
  userId: { type: String, required: true },
  tenantId: { type: String, required: true },
  targetType: {
    type: String,
    required: true,
    enum: FAVORITE_TARGET_TYPES,
    validate: (value) => (isFavoriteTargetType(value) ? true : "enum"),
  },
  targetId: { type: String, required: true },
  title: { type: String, default: "" },
  tenantName: { type: String, default: "" },
  created: { type: Date, default: () => new Date() },
};

module.exports = {
  favoriteSchemaDefinition,
  FavoriteTargetType,
  FAVORITE_TARGET_TYPES,
  isFavoriteTargetType,
};
