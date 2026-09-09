const MediaReferenceGuard = require("../media/media-reference-guard");
const SchemaUtils = require("../../utilities/schemaUtils");
const { MEDIA_REFERENCE_SOURCE } = require("../../schemas/mediaSchema");
const { HeroValidationErrors, childPath } = require("./hero-validation");

/**
 * The normaliser of the Hero Layout schema v1 (hero-layout spec, Shared
 * contract). It is hand-written on purpose: the two write paths it guards use
 * `findOneAndUpdate` without `runValidators`, so a mongoose-level schema would
 * never run, and the repo's `SchemaUtils.validate` walks top-level keys only.
 *
 * Three rules run through everything here:
 *
 * - **Stored = complete.** What comes back has every default filled, so
 *   nobody downstream has to know a default. The exception is a value the
 *   contract gives a fallback at render time — the dark colour of a colour
 *   Background, the dark entry of an overlay: an absent key stays absent. The
 *   storefront resolves both with `dark ?? light`, and the editor clears such a
 *   field by removing the key, which a filled-in default would undo.
 * - **Unknown keys are refused**, at any depth. The single exception is the
 *   derived trio `url`, `width`, `height` on a media reference, which the export
 *   adds and the editor sends back untouched; they are dropped in silence.
 * - **A key that carries `null` or an empty string is not given.** That is how
 *   the editor clears a field, so it reads as the default rather than as a
 *   fault.
 *
 * Faults are collected, not thrown at the first one, and answered as one
 * `ValidationError` whose `details[].field` is a JSON path into the request
 * body. The vocabulary is the eight codes of the contract's error table: where
 * a value is of the wrong JavaScript type or outside its range the answer is
 * `invalid_format` with `params.format` naming what was expected, rather than
 * one of the repo's `invalid_type_*`/`min_value` codes, so the contract stays
 * closed.
 *
 * This ticket fills in the Background. `normalizeHeroLayout` follows on the
 * same scaffolding.
 */

const ERROR_CODES = SchemaUtils.ERROR_CODES;

const BACKGROUND_VERSION = 1;
const BACKGROUND_VARIANTS = Object.freeze([
  "mesh",
  "aurora",
  "poly",
  "grid",
  "minimal",
]);
const BACKGROUND_INTENSITIES = Object.freeze(["subtle", "normal", "strong"]);

// No alpha, no shorthand — the colour convention of the Shared contract.
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Read-only keys the export adds to a media reference; stripped on the way in.
const MEDIA_REFERENCE_DERIVED_KEYS = Object.freeze(["url", "width", "height"]);

const MEDIA_REFERENCE_SOURCES = Object.freeze(
  Object.values(MEDIA_REFERENCE_SOURCE),
);

/**
 * The Background of an instance that stored none: today's `poly` variant. Also
 * what `background: null` resets to and what the Theme Bundle delivers in
 * place of a Background that is not stored or not active.
 */
const DEFAULT_BACKGROUND = Object.freeze({
  version: BACKGROUND_VERSION,
  type: "variant",
  variant: "poly",
  orbs: true,
  noise: true,
  intensity: "normal",
});

const DEFAULT_FOCAL_POINT = Object.freeze({ x: 50, y: 50 });
const DEFAULT_OVERLAY_ENTRY = Object.freeze({ color: "#000000", opacity: 40 });

/**
 * @param {*} value - Anything.
 * @returns {boolean} Whether it is a JSON object rather than an array or null.
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One object being read: it knows where the object sits in the request body,
 * which of its keys the schema has asked about, and where to report a fault.
 *
 * Reading a key and declaring it are separate: `declare` is the one method
 * that changes the reader, and what was never declared is what `rejectUnknown`
 * refuses at the end.
 */
class ObjectReader {
  /**
   * @param {Object} value - The object being read.
   * @param {string} path - Its JSON path in the request body.
   * @param {HeroValidationErrors} errors - The run's collector.
   */
  constructor(value, path, errors) {
    this.value = value;
    this.path = path;
    this.errors = errors;
    this.declaredKeys = new Set();
  }

  /**
   * Records that the schema knows these keys, whether or not they are there.
   *
   * @param {...string} keys - Keys of the object.
   */
  declare(...keys) {
    keys.forEach((key) => this.declaredKeys.add(key));
  }

  /**
   * Whether the key carries a value. An empty string, `null` and `undefined`
   * all read as "not given": that is how the editor clears a field.
   *
   * @param {string} key - Key of the object.
   * @returns {boolean}
   */
  given(key) {
    const value = this.value[key];
    return value !== undefined && value !== null && value !== "";
  }

  /**
   * @param {string} key - Key of the object.
   * @returns {*} The stored value.
   */
  raw(key) {
    return this.value[key];
  }

  /**
   * A reader for the object behind one of the keys. The key must be declared
   * and given; a value that is not an object is a fault here.
   *
   * @param {string} key - Key of the object.
   * @returns {?ObjectReader} The reader, or null when the value is no object.
   */
  child(key) {
    const path = childPath(this.path, key);

    if (!isPlainObject(this.raw(key))) {
      this.errors.add(path, ERROR_CODES.format, { format: "object" });
      return null;
    }

    return new ObjectReader(this.raw(key), path, this.errors);
  }

  /**
   * Records a fault at one of the object's keys.
   *
   * @param {string} key - Key of the object.
   * @param {string} code - Code of the contract's error vocabulary.
   * @param {Object} [params] - What the code needs to be understood.
   */
  fail(key, code, params) {
    this.errors.add(childPath(this.path, key), code, params);
  }

  /**
   * Refuses every key the schema never declared.
   */
  rejectUnknown() {
    for (const key of Object.keys(this.value)) {
      if (!this.declaredKeys.has(key)) {
        this.errors.add(childPath(this.path, key), ERROR_CODES.unknownField);
      }
    }
  }
}

/**
 * A value out of a fixed set. Without a fallback the key is required.
 *
 * @param {ObjectReader} reader - The object being read.
 * @param {string} key - Key of the object.
 * @param {Array<*>} allowed - The values of the enum.
 * @param {*} [fallback] - Default when the key is not given.
 * @returns {*} The value, the fallback, or null on a fault.
 */
function readEnum(reader, key, allowed, fallback) {
  reader.declare(key);

  if (!reader.given(key)) {
    if (fallback === undefined) {
      reader.fail(key, ERROR_CODES.required);
      return null;
    }
    return fallback;
  }

  const value = reader.raw(key);

  if (!allowed.includes(value)) {
    reader.fail(key, ERROR_CODES.enum, { allowed });
    return null;
  }

  return value;
}

/**
 * A boolean switch with a default.
 *
 * @param {ObjectReader} reader - The object being read.
 * @param {string} key - Key of the object.
 * @param {boolean} fallback - Default when the key is not given.
 * @returns {boolean} The value or the fallback.
 */
function readBoolean(reader, key, fallback) {
  reader.declare(key);

  if (!reader.given(key)) {
    return fallback;
  }

  const value = reader.raw(key);

  if (typeof value !== "boolean") {
    reader.fail(key, ERROR_CODES.format, { format: "boolean" });
    return fallback;
  }

  return value;
}

/**
 * A string value.
 *
 * @param {ObjectReader} reader - The object being read.
 * @param {string} key - Key of the object.
 * @param {boolean} required - Whether an absent key is a fault.
 * @returns {?string} The value, or null when absent or faulty.
 */
function readString(reader, key, required) {
  reader.declare(key);

  if (!reader.given(key)) {
    if (required) {
      reader.fail(key, ERROR_CODES.required);
    }
    return null;
  }

  const value = reader.raw(key);

  if (typeof value !== "string") {
    reader.fail(key, ERROR_CODES.format, { format: "string" });
    return null;
  }

  return value;
}

/**
 * A colour of the Background: `#rrggbb`, no shorthand and no alpha.
 *
 * @param {ObjectReader} reader - The object being read.
 * @param {string} key - Key of the object.
 * @param {boolean} required - Whether an absent key is a fault.
 * @returns {?string} The colour, or null when absent or faulty.
 */
function readHexColor(reader, key, required) {
  const value = readString(reader, key, required);

  if (value === null) {
    return null;
  }

  if (!HEX_COLOR.test(value)) {
    reader.fail(key, ERROR_CODES.format, { format: "hex" });
    return null;
  }

  return value;
}

/**
 * A whole percentage, 0 to 100.
 *
 * @param {ObjectReader} reader - The object being read.
 * @param {string} key - Key of the object.
 * @param {number} fallback - Default when the key is not given.
 * @returns {number} The value or the fallback.
 */
function readPercentage(reader, key, fallback) {
  reader.declare(key);

  if (!reader.given(key)) {
    return fallback;
  }

  const value = reader.raw(key);

  if (!Number.isInteger(value) || value < 0 || value > 100) {
    reader.fail(key, ERROR_CODES.format, { format: "percentage" });
    return fallback;
  }

  return value;
}

/**
 * A media reference of the Shared contract. What the medium behind it has to
 * be is not decided here: the reference is collected and checked against the
 * media library once the shape of the whole object is known.
 *
 * @param {ObjectReader} reader - The object carrying the reference.
 * @param {string} key - Key the reference sits at.
 * @param {Array<{field: string, reference: Object}>} references - Where the
 *   reference is collected for the media check.
 * @returns {?Object} The reference as it is stored, or null on a fault.
 */
function readMediaReference(reader, key, references) {
  const reference = reader.child(key);

  if (!reference) {
    return null;
  }

  // The export adds these three; refusing them would stop an enriched
  // reference from coming back through the editor unchanged.
  reference.declare(...MEDIA_REFERENCE_DERIVED_KEYS);

  const source = readEnum(reference, "source", MEDIA_REFERENCE_SOURCES);
  // An external reference carries no media id and is refused as a whole by the
  // media check, which names the reason; demanding an id here would answer the
  // wrong fault.
  const mediaId = readString(
    reference,
    "mediaId",
    source === MEDIA_REFERENCE_SOURCE.MEDIA,
  );

  reference.rejectUnknown();

  if (source === null) {
    return null;
  }

  const stored = mediaId ? { source, mediaId } : { source };
  references.push({ field: reference.path, reference: stored });

  return stored;
}

/**
 * The focal point of an image Background.
 *
 * @param {ObjectReader} reader - The Background being read.
 * @returns {{x: number, y: number}} The point, defaults filled.
 */
function readFocalPoint(reader) {
  reader.declare("focalPoint");

  if (!reader.given("focalPoint")) {
    return { ...DEFAULT_FOCAL_POINT };
  }

  const point = reader.child("focalPoint");

  if (!point) {
    return { ...DEFAULT_FOCAL_POINT };
  }

  const focalPoint = {
    x: readPercentage(point, "x", DEFAULT_FOCAL_POINT.x),
    y: readPercentage(point, "y", DEFAULT_FOCAL_POINT.y),
  };
  point.rejectUnknown();

  return focalPoint;
}

/**
 * One entry of the overlay — the colour painted over the image and how far it
 * darkens it.
 *
 * @param {ObjectReader} reader - The overlay being read.
 * @param {string} key - `light` or `dark`.
 * @returns {{color: string, opacity: number}} The entry, defaults filled.
 */
function readOverlayEntry(reader, key) {
  const entry = reader.child(key);

  if (!entry) {
    return { ...DEFAULT_OVERLAY_ENTRY };
  }

  const overlayEntry = {
    color: readHexColor(entry, "color", false) ?? DEFAULT_OVERLAY_ENTRY.color,
    opacity: readPercentage(entry, "opacity", DEFAULT_OVERLAY_ENTRY.opacity),
  };
  entry.rejectUnknown();

  return overlayEntry;
}

/**
 * The overlay of an image Background. An overlay that is not given at all is
 * the contract's default; one that is given has to name its light entry, the
 * one the dark mode falls back to.
 *
 * @param {ObjectReader} reader - The Background being read.
 * @returns {Object} The overlay, defaults filled.
 */
function readOverlay(reader) {
  reader.declare("overlay");

  if (!reader.given("overlay")) {
    return { light: { ...DEFAULT_OVERLAY_ENTRY } };
  }

  const overlay = reader.child("overlay");

  if (!overlay) {
    return { light: { ...DEFAULT_OVERLAY_ENTRY } };
  }

  overlay.declare("light", "dark");

  let light = null;
  if (overlay.given("light")) {
    light = readOverlayEntry(overlay, "light");
  } else {
    overlay.fail("light", ERROR_CODES.required);
  }

  const dark = overlay.given("dark") ? readOverlayEntry(overlay, "dark") : null;

  overlay.rejectUnknown();

  return dark ? { light, dark } : { light };
}

/**
 * The three families of the Background, each reading the half of the object
 * that belongs to it. The keys are the values of `type`.
 */
const BACKGROUND_FAMILIES = Object.freeze({
  variant: (reader) => ({
    variant: readEnum(reader, "variant", BACKGROUND_VARIANTS),
    orbs: readBoolean(reader, "orbs", DEFAULT_BACKGROUND.orbs),
    noise: readBoolean(reader, "noise", DEFAULT_BACKGROUND.noise),
    intensity: readEnum(
      reader,
      "intensity",
      BACKGROUND_INTENSITIES,
      DEFAULT_BACKGROUND.intensity,
    ),
  }),

  color: (reader) => {
    const light = readHexColor(reader, "light", true);
    // The dark colour falls back to the light one at render time, so an absent
    // key is the whole answer and no default is written for it.
    const dark = readHexColor(reader, "dark", false);

    return dark ? { light, dark } : { light };
  },

  image: (reader, references) => {
    reader.declare("image");

    const image = reader.given("image")
      ? readMediaReference(reader, "image", references)
      : (reader.fail("image", ERROR_CODES.required), null);

    return {
      image,
      focalPoint: readFocalPoint(reader),
      overlay: readOverlay(reader),
    };
  },
});

const BACKGROUND_TYPES = Object.freeze(Object.keys(BACKGROUND_FAMILIES));

/**
 * Reads one Background into its stored form, recording every fault it finds.
 *
 * @param {*} input - What the client sent.
 * @param {string} path - Its JSON path in the request body.
 * @param {HeroValidationErrors} errors - The run's collector.
 * @param {Array<{field: string, reference: Object}>} references - Where media
 *   references are collected for the media check.
 * @returns {?Object} The stored Background, or null when it cannot be read.
 */
function readBackground(input, path, errors, references) {
  if (!isPlainObject(input)) {
    errors.add(path, ERROR_CODES.format, { format: "object" });
    return null;
  }

  const reader = new ObjectReader(input, path, errors);

  readEnum(reader, "version", [BACKGROUND_VERSION]);
  const type = readEnum(reader, "type", BACKGROUND_TYPES);

  // Without the family nothing below is known, so the read stops here rather
  // than calling every remaining key unknown.
  if (type === null) {
    return null;
  }

  const background = {
    version: BACKGROUND_VERSION,
    type,
    ...BACKGROUND_FAMILIES[type](reader, references),
  };

  reader.rejectUnknown();

  return background;
}

/**
 * The stored form of a Background: every default filled, every derived media
 * key dropped, every fault answered at its JSON path.
 *
 * @param {?Object} input - What the client sent. `null` is the reset to the
 *   default Background and passes straight through — the default is filled in
 *   on the way out, so a Background that was never touched keeps following
 *   whatever the default becomes.
 * @param {string} [field] - Where the Background sits in the request body:
 *   `background` on the hero-layout routes, `branding.background` on the
 *   instance PUT. Every reported path starts here.
 * @returns {Promise<?Object>} The Background as it is stored.
 * @throws {ValidationError} With one detail per fault, JSON paths as fields.
 */
async function normalizeBackground(input, field = "background") {
  if (input === null || input === undefined) {
    return null;
  }

  const errors = new HeroValidationErrors();
  const references = [];

  const background = readBackground(input, field, errors, references);

  // The media library is only asked once the shape is sound: a lookup for a
  // reference that is malformed anyway would answer the wrong fault.
  errors.throwIfAny();
  await MediaReferenceGuard.assertHeroLayoutStorable(references);

  return background;
}

module.exports = {
  DEFAULT_BACKGROUND,
  normalizeBackground,
};
