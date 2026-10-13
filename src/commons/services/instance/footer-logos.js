const MediaManager = require("../../data-managers/media-manager");
const { mediaFileUrl } = require("../media/media-reference");
const { DOMAIN } = require("../authorization/reach");

/**
 * The footer logos as the Theme Bundle delivers them (map #510). They follow
 * `branding.active` like the logo: a switched-off branding delivers the
 * default, no logos, and the stored ones stay.
 */

/**
 * One image of a footer logo as it goes out: enriched like the logo with the
 * delivery URL and the dimensions of the medium, and with the name of the
 * medium, which the storefront shows as the alternative text. A medium that
 * is gone still yields its URL, like every other reference of the bundle.
 *
 * @param {?Object} reference - The stored reference, `{ source, mediaId }`.
 * @returns {Promise<?Object>} The reference with `url`, `width`, `height` and
 *   `name`, or null when the site is empty.
 */
async function exportFooterImage(reference) {
  if (!reference?.mediaId) {
    return null;
  }

  // Branding media are instance media: the lookup carries no tenant.
  const media = await MediaManager.getMedia(reference.mediaId, null, DOMAIN);

  return {
    source: reference.source,
    mediaId: reference.mediaId,
    url: mediaFileUrl(reference.mediaId, null),
    width: media?.width ?? null,
    height: media?.height ?? null,
    name: media?.title || media?.originalFileName || "",
  };
}

/**
 * The footer logos in force, in their stored order, images enriched.
 *
 * @param {?Object} branding - The instance branding.
 * @returns {Promise<Array<Object>>} The logos, empty while the branding is
 *   switched off or holds none.
 */
async function exportFooterLogos(branding) {
  const logos = branding?.active ? branding.footerLogos ?? [] : [];

  return Promise.all(
    logos.map(async (logo) => ({
      image: await exportFooterImage(logo.image),
      size: logo.size,
      link: logo.link,
      imageDark: await exportFooterImage(logo.imageDark),
    })),
  );
}

module.exports = { exportFooterLogos };
