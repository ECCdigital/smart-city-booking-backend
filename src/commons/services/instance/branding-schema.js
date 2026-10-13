/**
 * The appearance of the portal as `Instance.branding` stores it (map #510):
 * its defaults, the one place they are filled in, and the check on save.
 *
 * The branding is a free object on the instance schema, so nothing below its
 * top level is checked or defaulted by the schema. A field added here needs no
 * migration: an instance that never stored it reads its default.
 */

const SchemaUtils = require("../../utilities/schemaUtils");
const { MEDIA_REFERENCE_SOURCE } = require("../../schemas/mediaSchema");
const {
  HEX_COLOR,
  HeroValidationErrors,
  carries,
  childPath,
} = require("../hero-layout/hero-validation");
const { readFont } = require("./branding-font");

const ERROR_CODES = SchemaUtils.ERROR_CODES;

// The colours the header can take: neutral is fixed, the other two follow the
// colours of the instance.
const HEADER_COLORS = Object.freeze(["neutral", "primary", "secondary"]);

// The sizes of the logo on the sign-in pages.
const AUTH_LOGO_SIZES = Object.freeze(["sm", "md", "lg"]);

/**
 * The branding of an instance that stored none: the default look, switched
 * off. A fresh object per call, so no caller can change the defaults.
 *
 * @returns {Object} The default branding.
 */
function defaultBranding() {
  return {
    active: false,
    theme: {
      colors: { primary: "", secondary: "", accent: "" },
    },
    header: "primary",
    authLogoSize: "sm",
    // The system font; see `branding-font.js`.
    font: null,
    logo: null,
    logoDark: null,
    favicon: null,
    logoUrl: "",
    faviconUrl: "",
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The branding with every field it does not carry read as its default, the
 * nested colours included: an instance from before the accent colour stored
 * `theme.colors` without it. What is stored wins; a value that is no object
 * where one is expected is left as it is, for the check to answer.
 *
 * @param {*} branding - The branding as stored or sent.
 * @returns {*} The branding with its defaults, or the input if it is no object.
 */
function withBrandingDefaults(branding) {
  if (branding === undefined || branding === null) {
    return defaultBranding();
  }

  if (!isPlainObject(branding)) {
    return branding;
  }

  const defaults = defaultBranding();
  const result = { ...defaults, ...branding };

  if (isPlainObject(branding.theme)) {
    result.theme = { ...defaults.theme, ...branding.theme };

    if (isPlainObject(branding.theme.colors)) {
      result.theme.colors = {
        ...defaults.theme.colors,
        ...branding.theme.colors,
      };
    }
  }

  return result;
}

/**
 * Checks the accent colour: empty for none, or `#rrggbb`. A value that is no
 * string is refused like a malformed one.
 *
 * @param {Object} branding - The branding being saved.
 * @param {HeroValidationErrors} errors - The run the faults go into.
 * @param {string} path - Path of the branding in the request body.
 */
function checkAccent(branding, errors, path) {
  const colors = branding.theme?.colors;

  if (!isPlainObject(colors) || !carries(colors, "accent")) {
    return;
  }

  const accent = colors.accent;

  if (accent === "" || (typeof accent === "string" && HEX_COLOR.test(accent))) {
    return;
  }

  errors.add(
    childPath(childPath(childPath(path, "theme"), "colors"), "accent"),
    ERROR_CODES.format,
    { format: "color" },
  );
}

/**
 * Checks a field that takes one value of a list, when the branding names it.
 *
 * @param {Object} branding - The branding being saved.
 * @param {string} key - The field.
 * @param {ReadonlyArray<string>} allowed - Its values.
 * @param {HeroValidationErrors} errors - The run the faults go into.
 * @param {string} path - Path of the branding in the request body.
 */
function checkEnum(branding, key, allowed, errors, path) {
  if (!carries(branding, key) || allowed.includes(branding[key])) {
    return;
  }

  errors.add(childPath(path, key), ERROR_CODES.enum, { allowed: [...allowed] });
}

/**
 * The variant of the app logo for the dark mode as it is stored: null for
 * none, or the reference `{ source: "media", mediaId }` alone. What the export
 * adds to it (`url`, `width`, `height`) is dropped, so an enriched reference
 * comes back from the Admin UI unchanged. A foreign address is refused: the
 * variant is a public image of the instance library, which the
 * `MediaReferenceGuard` checks before the instance is written.
 *
 * @param {Object} branding - The branding being saved.
 * @param {HeroValidationErrors} errors - The run the faults go into.
 * @param {string} path - Path of the branding in the request body.
 * @returns {?Object} The variant to store, null for none or a fault.
 */
function readLogoDark(branding, errors, path) {
  const logoDark = branding.logoDark;
  const logoDarkPath = childPath(path, "logoDark");

  if (logoDark === undefined || logoDark === null) {
    return null;
  }

  if (!isPlainObject(logoDark)) {
    errors.add(logoDarkPath, ERROR_CODES.format, {
      format: "media_reference",
    });
    return null;
  }

  if (logoDark.source !== MEDIA_REFERENCE_SOURCE.MEDIA) {
    errors.add(childPath(logoDarkPath, "source"), ERROR_CODES.enum, {
      allowed: [MEDIA_REFERENCE_SOURCE.MEDIA],
    });
    return null;
  }

  if (typeof logoDark.mediaId !== "string" || logoDark.mediaId === "") {
    errors.add(childPath(logoDarkPath, "mediaId"), ERROR_CODES.required);
    return null;
  }

  return { source: MEDIA_REFERENCE_SOURCE.MEDIA, mediaId: logoDark.mediaId };
}

/**
 * The branding as it is stored: checked field by field, every fault collected
 * so the admin sees all of them at once, then with its defaults filled in.
 * Each field of the appearance has its check here; the fields to come join in
 * the same run.
 *
 * Only the fields of the appearance are checked. The rest of the branding —
 * the switch, the primary and secondary colours, logo and favicon, the
 * derived read fields — is taken as before. Of the variant of the logo only
 * the shape is checked here; the medium behind every reference is checked by
 * the `MediaReferenceGuard` before the instance is written.
 *
 * @param {*} branding - The branding of the request body.
 * @param {string} [path="branding"] - Its path in the request body.
 * @returns {*} The branding to store.
 * @throws {ValidationError} With every fault, each at its path below
 *   `branding`.
 */
function normalizeBranding(branding, path = "branding") {
  if (!isPlainObject(branding)) {
    return withBrandingDefaults(branding);
  }

  const errors = new HeroValidationErrors();

  checkAccent(branding, errors, path);
  checkEnum(branding, "header", HEADER_COLORS, errors, path);
  checkEnum(branding, "authLogoSize", AUTH_LOGO_SIZES, errors, path);
  const logoDark = readLogoDark(branding, errors, path);
  const font = readFont(branding, errors, path);

  errors.throwIfAny();

  // The font in its stored shape; its licence is settled against the stored
  // instance (`confirmFontLicense`).
  return { ...withBrandingDefaults(branding), logoDark, font };
}

module.exports = {
  AUTH_LOGO_SIZES,
  HEADER_COLORS,
  defaultBranding,
  normalizeBranding,
  withBrandingDefaults,
};
