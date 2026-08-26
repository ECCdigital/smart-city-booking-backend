const crypto = require("crypto");
const sharp = require("sharp");

const { BadRequestError } = require("../../../errors/BaseError");
const { imageMaxPixels, sharpConcurrency } = require("./media-config");
const { SVG_MIME_TYPE } = require("./media-file-type");

const VARIANT_FORMAT = "webp";
const VARIANT_MIME_TYPE = "image/webp";
const VARIANT_QUALITY = 80;

/**
 * The image presets, smallest first — the order is also the degradation ladder
 * of `?size=`. Frontends pick a preset by name, never by pixels.
 */
const IMAGE_PRESETS = [
  { name: "thumb", width: 160, height: 160, fit: "cover" },
  { name: "sm", width: 480, height: null, fit: "inside" },
  { name: "md", width: 800, height: null, fit: "inside" },
  { name: "lg", width: 1600, height: null, fit: "inside" },
];

const PRESET_NAMES = IMAGE_PRESETS.map((preset) => preset.name);

// Rasterising a vector at 72 DPI would leave every variant blurry; the density
// is scaled so the rendered pixels reach the preset before the resize.
const SVG_BASE_DENSITY = 72;
const SVG_MAX_DENSITY = 2400;

/**
 * Sizes the libvips thread pool. Called once at boot: the setting is global to
 * the process, so it must not be a side effect of importing this module.
 *
 * @returns {void}
 */
function applySharpConcurrency() {
  sharp.concurrency(sharpConcurrency());
}

/**
 * Looks up a preset by name.
 *
 * @param {string} name - Preset name.
 * @returns {Object|undefined} The preset, undefined if the name is unknown.
 */
function presetByName(name) {
  return IMAGE_PRESETS.find((preset) => preset.name === name);
}

/**
 * Density needed to rasterise an SVG at least as wide as the preset.
 *
 * @param {Object} preset - The target preset.
 * @param {number|null} sourceWidth - Width of the SVG viewport.
 * @returns {number} Density in DPI.
 */
function svgDensityFor(preset, sourceWidth) {
  if (!sourceWidth) {
    return SVG_BASE_DENSITY;
  }

  const scaled = Math.ceil(SVG_BASE_DENSITY * (preset.width / sourceWidth));
  return Math.min(SVG_MAX_DENSITY, Math.max(SVG_BASE_DENSITY, scaled));
}

/**
 * Renders a single variant.
 *
 * @param {Object} params
 * @param {Buffer} params.data - The original bytes.
 * @param {Object} params.preset - The preset to render.
 * @param {boolean} params.vector - Whether the original is an SVG.
 * @param {number|null} params.sourceWidth - Width of the original.
 * @returns {Promise<{data: Buffer, width: number, height: number}>}
 */
async function renderVariant({ data, preset, vector, sourceWidth }) {
  const input = sharp(data, {
    limitInputPixels: imageMaxPixels(),
    ...(vector ? { density: svgDensityFor(preset, sourceWidth) } : {}),
  });

  const { data: buffer, info } = await input
    // EXIF orientation is stripped with the rest of the metadata — without
    // this, portrait phone photos come out sideways.
    .autoOrient()
    .resize(preset.width, preset.height, {
      fit: preset.fit,
      // Width presets never upscale. The square crop does: a thumbnail grid
      // needs every tile at the same size, so a wide-and-flat original is
      // stretched to fill its 160×160 tile.
      withoutEnlargement: preset.fit === "inside",
    })
    .webp({ quality: VARIANT_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return { data: buffer, width: info.width, height: info.height };
}

/**
 * Generates every variant an image medium gets. Presets that would not shrink
 * the original produce no variant; vector originals are rasterised for all
 * presets because they have no natural resolution to preserve.
 *
 * Animated GIFs are reduced to their first frame — variants are stills.
 *
 * @param {Object} params
 * @param {Buffer} params.data - The original bytes.
 * @param {string} params.mimeType - Detected MIME type of the original.
 * @param {number|null} [params.sourceWidth] - Width of the original.
 * @returns {Promise<Array<Object>>} The generated variants, smallest first.
 * @throws {BadRequestError} When a variant cannot be rendered.
 */
async function generateImageVariants({ data, mimeType, sourceWidth }) {
  const vector = mimeType === SVG_MIME_TYPE;
  const variants = [];

  for (const preset of IMAGE_PRESETS) {
    if (!vector && sourceWidth && preset.width >= sourceWidth) {
      continue;
    }

    let rendered;
    try {
      rendered = await renderVariant({ data, preset, vector, sourceWidth });
    } catch (error) {
      throw new BadRequestError("image_processing_failed", {
        preset: preset.name,
        message: error?.message,
      });
    }

    variants.push({
      name: preset.name,
      format: VARIANT_FORMAT,
      width: rendered.width,
      height: rendered.height,
      size: rendered.data.length,
      checksum: crypto.createHash("sha256").update(rendered.data).digest("hex"),
      data: rendered.data,
    });
  }

  return variants;
}

module.exports = {
  IMAGE_PRESETS,
  PRESET_NAMES,
  VARIANT_MIME_TYPE,
  applySharpConcurrency,
  generateImageVariants,
  presetByName,
};
