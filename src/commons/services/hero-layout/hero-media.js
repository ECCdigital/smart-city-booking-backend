const MediaManager = require("../../data-managers/media-manager");
const { mediaFileUrl } = require("../media/media-reference");

/**
 * The media half of the Hero Layout export. A stored media reference is the
 * pair `{ source, mediaId }` and nothing else; on the way out it gains the
 * three derived keys the storefront and the editor need to lay the image out
 * without a second request: the delivery URL and the dimensions of the
 * original as they sit on the medium.
 *
 * The normaliser strips those three again on the way in, so an enriched
 * reference round-trips through the editor untouched.
 */

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
  const media = await MediaManager.getMedia(reference.mediaId, null);

  return {
    source: reference.source,
    mediaId: reference.mediaId,
    url: mediaFileUrl(reference.mediaId, null),
    width: media?.width ?? null,
    height: media?.height ?? null,
  };
}

module.exports = { enrichHeroMediaReference };
