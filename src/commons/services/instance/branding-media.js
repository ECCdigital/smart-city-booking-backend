const MediaManager = require("../../data-managers/media-manager");
const { DOMAIN } = require("../authorization/reach");
const { MEDIA_REFERENCE_SOURCE } = require("../../schemas/mediaSchema");
const { mediaFileUrl } = require("../media/media-reference");
const SchemaUtils = require("../../utilities/schemaUtils");
const { childPath, isPlainObject } = require("../hero-layout/hero-validation");

/**
 * The media of the branding (map #510): the variant of the logo for the dark
 * mode, the images of the footer logos and the font of the library. Each is
 * stored as the reference `{ source: "media", mediaId }` alone and goes out
 * with the delivery URL and the name of its medium.
 */

const ERROR_CODES = SchemaUtils.ERROR_CODES;

/**
 * Reads a media reference of the branding as it is stored, `{ source,
 * mediaId }`: the keys the export adds are dropped, so an enriched reference
 * comes back unchanged. Only a medium of the library is taken, never a
 * foreign address; what the medium has to be (public, of the instance, of the
 * right kind) is the `MediaReferenceGuard`'s.
 *
 * @param {*} reference - The reference as sent.
 * @param {HeroValidationErrors} errors - The run the faults go into.
 * @param {string} path - Path of the reference in the request body.
 * @param {Object} [options]
 * @param {boolean} [options.required=false] - Whether a missing or null
 *   reference is a fault.
 * @returns {?Object} The reference, or null when there is none or it is
 *   faulty.
 */
function readMediaReference(
  reference,
  errors,
  path,
  { required = false } = {},
) {
  if (reference === undefined || reference === null) {
    if (required) {
      errors.add(path, ERROR_CODES.required);
    }
    return null;
  }

  if (!isPlainObject(reference)) {
    errors.add(path, ERROR_CODES.format, { format: "object" });
    return null;
  }

  if (reference.source !== MEDIA_REFERENCE_SOURCE.MEDIA) {
    errors.add(childPath(path, "source"), ERROR_CODES.enum, {
      allowed: [MEDIA_REFERENCE_SOURCE.MEDIA],
    });
    return null;
  }

  const { mediaId } = reference;

  if (typeof mediaId !== "string" || mediaId.trim() === "") {
    errors.add(childPath(path, "mediaId"), ERROR_CODES.required);
    return null;
  }

  return { source: MEDIA_REFERENCE_SOURCE.MEDIA, mediaId };
}

/**
 * The medium behind a stored reference of the branding, with its delivery URL
 * and its name. A medium that is gone still yields the URL, like every other
 * reference of the Theme Bundle.
 *
 * @param {Object} reference - The stored reference, `{ source, mediaId }`.
 * @returns {Promise<{medium: ?Object, url: string, name: ?string}>} The
 *   medium (null when gone), its URL, and its title or file name (null when
 *   it has neither).
 */
async function readBrandingMedium(reference) {
  // Branding media are instance media: the lookup carries no tenant.
  const medium = await MediaManager.getMedia(reference.mediaId, null, DOMAIN);

  return {
    medium,
    url: mediaFileUrl(reference.mediaId, null),
    name: medium?.title || medium?.originalFileName || null,
  };
}

module.exports = { readBrandingMedium, readMediaReference };
