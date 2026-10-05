const SchemaUtils = require("../../utilities/schemaUtils");
const {
  favoriteSchemaDefinition,
  FavoriteTargetType,
  FAVORITE_TARGET_TYPES,
  isFavoriteTargetType,
} = require("../../schemas/favoriteSchema");

/**
 * A favorite (glossary "Favorit"): one user's mark on one offer of a
 * tenant, with the snapshot of title and tenant name taken when it was set.
 */
class Favorite {
  /**
   * @param {Object} params Favorite parameters
   */
  constructor(params = {}) {
    Object.assign(this, SchemaUtils.createDefaults(favoriteSchemaDefinition));

    Object.keys(favoriteSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  /**
   * The persisted fields of the favorite.
   *
   * @returns {Object} Favorite data to be stored
   */
  toDocument() {
    return Object.keys(favoriteSchemaDefinition).reduce((document, key) => {
      document[key] = this[key];
      return document;
    }, {});
  }

  /**
   * The favorite as the API answers it: the entry of the user's own list,
   * so the user is not repeated.
   *
   * @returns {Object} Favorite data without the user id
   */
  toResponse() {
    const response = this.toDocument();
    delete response.userId;
    return response;
  }

  /**
   * The favorite as a reference alone: the target and when it was set,
   * without the snapshot - what a catalog view needs to colour the heart.
   *
   * @returns {{tenantId: string, targetType: string, targetId: string, created: Date}}
   */
  toReference() {
    const { tenantId, targetType, targetId, created } = this;
    return { tenantId, targetType, targetId, created };
  }

  /**
   * Validate the favorite
   * @returns {boolean} True if valid
   */
  validate() {
    SchemaUtils.validate(this, favoriteSchemaDefinition);
    return true;
  }

  /**
   * Create a new favorite.
   *
   * @param {Object} params Favorite parameters
   * @returns {Favorite} The created favorite
   */
  static create(params = {}) {
    const favorite = new Favorite(params);
    favorite.validate();
    return favorite;
  }
}

module.exports = {
  Favorite,
  FavoriteTargetType,
  FAVORITE_TARGET_TYPES,
  isFavoriteTargetType,
};
