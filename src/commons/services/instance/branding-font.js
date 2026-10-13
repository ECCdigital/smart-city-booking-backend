/**
 * The font of the portal in `Instance.branding.font` (map #510,
 * ECCdigital/tickets#524): `null` for the system font, one of the curated
 * list, or a font of the instance library with a confirmed web licence.
 *
 *   null
 *   | { source: "curated", id }
 *   | { source: "media", reference: { source: "media", mediaId },
 *       license: { confirmedAt, confirmedBy } }
 *
 * The licence is the proof for customer care of who confirmed it and when.
 * The form sends a tick alone (`license: { confirmed: true }`); the person and
 * the moment come from the session, never from the form. A confirmation holds
 * for the file it was given for: once the reference changes, a new tick is
 * needed. The licence never leaves the backend except to the instance owner.
 */

const SchemaUtils = require("../../utilities/schemaUtils");
const {
  HeroValidationErrors,
  carries,
  childPath,
  isPlainObject,
} = require("../hero-layout/hero-validation");
const { readBrandingMedium, readMediaReference } = require("./branding-media");

const ERROR_CODES = SchemaUtils.ERROR_CODES;

const FONT_SOURCE = Object.freeze({
  CURATED: "curated",
  MEDIA: "media",
});

// The free fonts the storefront ships itself. The admin UI and the storefront
// keep their own copy under the same ids (map #510, story 92): a new font
// touches all three repositories.
const CURATED_FONT_IDS = Object.freeze([
  "inter",
  "open-sans",
  "roboto",
  "noto-sans",
  "public-sans",
  "atkinson-hyperlegible-next",
  "ibm-plex-sans",
  "figtree",
  "noto-serif",
]);

/**
 * A value of a fixed list at a key of an object, which is required.
 *
 * @returns {*} The value, or null on a fault.
 */
function readEnum(object, key, allowed, errors, path) {
  if (!carries(object, key) || object[key] === undefined) {
    errors.add(childPath(path, key), ERROR_CODES.required);
    return null;
  }

  if (!allowed.includes(object[key])) {
    errors.add(childPath(path, key), ERROR_CODES.enum, {
      allowed: [...allowed],
    });
    return null;
  }

  return object[key];
}

/**
 * Checks the font of a branding being saved, every fault into the run, and
 * answers it in its stored shape. A font of the library keeps the licence as
 * the form sent it; `confirmFontLicense` settles it once the stored instance
 * is known.
 *
 * @param {Object} branding - The branding being saved.
 * @param {HeroValidationErrors} errors - The run the faults go into.
 * @param {string} path - Path of the branding in the request body.
 * @returns {?Object} The font, null for the system font, or null on a fault.
 */
function readFont(branding, errors, path) {
  const font = branding.font;
  const fontPath = childPath(path, "font");

  if (font === null || font === undefined) {
    return null;
  }

  if (!isPlainObject(font)) {
    errors.add(fontPath, ERROR_CODES.format, { format: "object" });
    return null;
  }

  const source = readEnum(
    font,
    "source",
    Object.values(FONT_SOURCE),
    errors,
    fontPath,
  );

  if (source === FONT_SOURCE.CURATED) {
    const id = readEnum(font, "id", CURATED_FONT_IDS, errors, fontPath);
    return id === null ? null : { source, id };
  }

  if (source === FONT_SOURCE.MEDIA) {
    // The keys the export adds (`url`, `name`, `size`) are dropped, so what
    // `GET /api/instances` answered comes back unchanged.
    const reference = readMediaReference(
      font.reference,
      errors,
      childPath(fontPath, "reference"),
      { required: true },
    );
    return reference === null
      ? null
      : { source, reference, license: font.license ?? null };
  }

  return null;
}

/**
 * The confirmed licence of a font of the library, from the stored instance
 * or from the tick of the form. The stored confirmation holds while the font
 * is the same file and the form does not untick it: a licence left out or
 * ticked again leaves it as it is, so the proof keeps naming whoever
 * confirmed first, while `confirmed: false` withdraws it. A new file needs a
 * new tick, stamped with the person of the session and the moment of the
 * save.
 *
 * @param {?Object} font - The font being saved, as `readFont` answered it.
 * @param {?Object} storedFont - The font as it is stored.
 * @param {Object} session
 * @param {?string} session.confirmedBy - Login of the person saving.
 * @param {Date} [session.now] - The moment of the save.
 * @returns {?Object} The font to store.
 * @throws {ValidationError} `required` at `branding.font.license` when a new
 *   file comes without the tick, or any file with the tick taken off.
 */
function confirmFontLicense(
  font,
  storedFont,
  { confirmedBy, now = new Date() },
) {
  if (font?.source !== FONT_SOURCE.MEDIA) {
    return font ?? null;
  }

  const sameFile =
    storedFont?.source === FONT_SOURCE.MEDIA &&
    storedFont.reference?.mediaId === font.reference.mediaId &&
    Boolean(storedFont.license?.confirmedAt);
  const unticked = font.license?.confirmed === false;

  if (sameFile && !unticked) {
    const { confirmedAt, confirmedBy: storedBy } = storedFont.license;
    return { ...font, license: { confirmedAt, confirmedBy: storedBy ?? null } };
  }

  if (font.license?.confirmed !== true) {
    const errors = new HeroValidationErrors();
    errors.add("branding.font.license", ERROR_CODES.required);
    errors.throwIfAny();
  }

  return {
    ...font,
    license: {
      confirmedAt: now.toISOString(),
      confirmedBy: confirmedBy ?? null,
    },
  };
}

/**
 * The reference of the font, when it is one of the library — the site the
 * media guard and the usage proof look at.
 *
 * @param {?Object} branding - The branding.
 * @returns {?Object} The reference, or null.
 */
function fontReference(branding) {
  const font = branding?.font;

  return font?.source === FONT_SOURCE.MEDIA ? font.reference ?? null : null;
}

/**
 * The branding without the licence of its font, for whoever is not the
 * instance owner.
 *
 * @param {*} branding - The branding.
 * @returns {*} A copy without `font.license`, or the input when there is none.
 */
function withoutFontLicense(branding) {
  if (!isPlainObject(branding?.font) || !carries(branding.font, "license")) {
    return branding;
  }

  const font = { ...branding.font };
  delete font.license;

  return { ...branding, font };
}

/**
 * The font the Theme Bundle delivers. Like the theme it follows
 * `branding.active`: switched off, the storefront gets the system font. A
 * font of the library goes out with the URL, the name and the size of its
 * medium; a medium that is gone still yields its URL. The licence stays in
 * the backend.
 *
 * @param {?Object} branding - The instance branding.
 * @returns {Promise<?Object>} The font, or null for the system font.
 */
async function exportFont(branding) {
  const font = branding?.active ? branding.font ?? null : null;

  if (font?.source === FONT_SOURCE.CURATED) {
    return { source: font.source, id: font.id };
  }

  const reference = font?.source === FONT_SOURCE.MEDIA ? font.reference : null;

  if (!reference?.mediaId) {
    return null;
  }

  const { medium, url, name } = await readBrandingMedium(reference);

  return {
    source: FONT_SOURCE.MEDIA,
    reference: {
      source: reference.source,
      mediaId: reference.mediaId,
      url,
      name,
      size: medium?.size ?? null,
    },
  };
}

module.exports = {
  confirmFontLicense,
  exportFont,
  fontReference,
  readFont,
  withoutFontLicense,
};
