const MediaManager = require("../../data-managers/media-manager");
const { mediaFileUrl } = require("../media/media-reference");
const { DOMAIN } = require("../authorization/reach");
const {
  MEDIA_KIND,
  MEDIA_REFERENCE_SOURCE,
} = require("../../schemas/mediaSchema");
const SchemaUtils = require("../../utilities/schemaUtils");
const { ValidationError } = require("../../../errors/ValidationError");

/**
 * The media half of the Hero Layout. A stored media reference is the pair
 * `{ source, mediaId }` and nothing else; on the way out it gains the three
 * derived keys the storefront and the editor need to lay the image out
 * without a second request: the delivery URL and the dimensions of the
 * original as they sit on the medium.
 *
 * The normaliser strips those three again on the way in, so an enriched
 * reference round-trips through the editor untouched. On the way in the
 * medium is checked too, for its facts alone: the right to save a Hero is
 * the route's (`instanceCatalog.store` on the marker), and whoever holds
 * it may pin any public image of the instance library.
 */

/**
 * Why a media reference may not carry the Hero. Travels to the admin UI as
 * `params.reason` of an `invalid_custom` detail, so the editor can name the
 * rule that was broken.
 */
const HERO_MEDIA_REFUSAL = Object.freeze({
  EXTERNAL: "external",
  NOT_INSTANCE: "not_instance",
  NOT_PUBLIC: "not_public",
  NOT_IMAGE: "not_image",
});

/**
 * One media reference as it goes out. A medium that is gone, or one from
 * before 4.3 that `media-cli backfill-dimensions` has not reached, still
 * yields a reference with its derived URL: dropping the Block or falling back
 * to another Background would show the editor something else than the
 * storefront.
 *
 * @param {?Object} reference - The stored reference, `{ source, mediaId }`.
 * @returns {Promise<?Object>} The reference with `url`, `width` and `height`,
 *   or null when the site is empty. `width`/`height` are null while the
 *   medium carries none.
 */
async function enrichHeroMediaReference(reference) {
  if (!reference?.mediaId) {
    return reference ?? null;
  }

  // Hero media are instance media: the lookup carries no tenant.
  const media = await MediaManager.getMedia(reference.mediaId, null, DOMAIN);

  return {
    source: reference.source,
    mediaId: reference.mediaId,
    url: mediaFileUrl(reference.mediaId, null),
    width: media?.width ?? null,
    height: media?.height ?? null,
  };
}

/**
 * Why a media reference may not carry the Hero: it has to point at a public
 * image of the instance library, never at a foreign address, a tenant
 * medium, an internal one or a document. The Hero is painted for anonymous
 * visitors, and the instance library is the only scope the instance catalog
 * reaches.
 *
 * An id the instance scope cannot find reads as `not_instance`: a tenant
 * medium and one that does not exist look the same from here, and both are
 * equally out of reach.
 *
 * @param {Object} reference - The stored reference, `{ source, mediaId }`.
 * @returns {Promise<?string>} The reason it is refused, or null when it may
 *   be stored.
 */
async function heroLayoutRefusal(reference) {
  if (reference?.source !== MEDIA_REFERENCE_SOURCE.MEDIA) {
    return HERO_MEDIA_REFUSAL.EXTERNAL;
  }

  const media = await MediaManager.getMedia(reference.mediaId, null, DOMAIN);

  if (!media) {
    return HERO_MEDIA_REFUSAL.NOT_INSTANCE;
  }

  if (!media.isPublic()) {
    return HERO_MEDIA_REFUSAL.NOT_PUBLIC;
  }

  if (media.kind !== MEDIA_KIND.IMAGE) {
    return HERO_MEDIA_REFUSAL.NOT_IMAGE;
  }

  return null;
}

/**
 * Checks every image a Hero Layout or a Background points at. Unlike the
 * other reference sites this answers a `ValidationError`, not a
 * `BadRequestError`: the Hero editor puts the message at the field that
 * carries the fault, so every refusal needs the JSON path it happened at.
 *
 * @param {Array<{field: string, reference: Object}>} references - Each
 *   reference with its JSON path in the request body.
 * @returns {Promise<void>}
 * @throws {ValidationError} One `invalid_custom` detail per refused
 *   reference, `params.reason` naming which rule it broke.
 */
async function assertHeroLayoutStorable(references) {
  const details = [];

  for (const { field, reference } of references) {
    const reason = await heroLayoutRefusal(reference);

    if (reason) {
      details.push({
        field,
        code: SchemaUtils.ERROR_CODES.validate,
        params: { reason },
      });
    }
  }

  if (details.length > 0) {
    throw new ValidationError(details);
  }
}

module.exports = {
  HERO_MEDIA_REFUSAL,
  assertHeroLayoutStorable,
  enrichHeroMediaReference,
  heroLayoutRefusal,
};
