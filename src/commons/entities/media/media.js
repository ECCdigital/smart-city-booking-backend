const { v4: uuidv4 } = require("uuid");
const {
  mediaSchemaDefinition,
  MEDIA_KIND,
  MEDIA_VISIBILITY,
} = require("../../schemas/mediaSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

/**
 * A medium is the database record describing a platform-managed file and the
 * sole source of truth about it — the storage only holds bytes.
 */
class Media {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(mediaSchemaDefinition);
    Object.assign(this, defaults, params);
  }

  static KIND = MEDIA_KIND;
  static VISIBILITY = MEDIA_VISIBILITY;

  /**
   * Validate the medium against its schema definition.
   *
   * @returns {boolean} True if valid.
   */
  validate() {
    SchemaUtils.validate(this, mediaSchemaDefinition);
    return true;
  }

  /**
   * Create a new, validated medium. Generates an id when none is given.
   *
   * @param {Object} params - Media parameters.
   * @returns {Media} The created medium.
   */
  static create(params = {}) {
    const media = new Media({ id: params.id || uuidv4(), ...params });
    media.validate();
    return media;
  }

  /**
   * Whether the medium is readable without any authentication.
   *
   * @returns {boolean}
   */
  isPublic() {
    return this.visibility === MEDIA_VISIBILITY.PUBLIC;
  }

  /**
   * A medium linked to at least one booking is a booking document: reading
   * follows the receipt rule, its visibility is meaningless and it never shows
   * up in the media picker. A document with zero bookings is not a valid
   * state — the medium dies with its last booking (§4.7).
   *
   * @returns {boolean}
   */
  isBookingDocument() {
    return Array.isArray(this.bookingIds) && this.bookingIds.length > 0;
  }
}

module.exports = { Media, MEDIA_KIND, MEDIA_VISIBILITY };
