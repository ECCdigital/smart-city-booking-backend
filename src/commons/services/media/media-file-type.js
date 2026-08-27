const mime = require("mime-types");
const sharp = require("sharp");

const { BadRequestError } = require("../../../errors/BaseError");
const { MEDIA_KIND } = require("../../schemas/mediaSchema");
const { imageMaxPixels } = require("./media-config");

const SVG_MIME_TYPE = "image/svg+xml";
const ICO_MIME_TYPE = "image/x-icon";
const GENERIC_MIME_TYPE = "application/octet-stream";

/**
 * The upload allowlist. The detected type decides — the file name extension is
 * never consulted, it only ever becomes part of the storage key.
 *
 * An image type without `sharpFormats` is one sharp cannot read: it is stored
 * exactly as uploaded, without a decode check and without variants. Its magic
 * bytes are still the only thing that lets it in.
 */
const ALLOWED_TYPES = [
  {
    mimeType: "image/jpeg",
    kind: MEDIA_KIND.IMAGE,
    sharpFormats: ["jpeg", "jpg"],
  },
  { mimeType: "image/png", kind: MEDIA_KIND.IMAGE, sharpFormats: ["png"] },
  { mimeType: "image/webp", kind: MEDIA_KIND.IMAGE, sharpFormats: ["webp"] },
  { mimeType: "image/gif", kind: MEDIA_KIND.IMAGE, sharpFormats: ["gif"] },
  { mimeType: SVG_MIME_TYPE, kind: MEDIA_KIND.IMAGE, sharpFormats: ["svg"] },
  // The one thing an ICO is for is a favicon, which is served at its own size
  // — so nothing is lost by having no variants (§4.9).
  { mimeType: ICO_MIME_TYPE, kind: MEDIA_KIND.IMAGE, sharpFormats: [] },
  { mimeType: "application/pdf", kind: MEDIA_KIND.DOCUMENT, sharpFormats: [] },
];

const ALLOWED_MIME_TYPES = ALLOWED_TYPES.map((type) => type.mimeType);

// The first bytes are enough for every magic number in the allowlist and for
// the XML prologue of an SVG.
const SNIFF_BYTES = 4096;

let fileTypeModule = null;

/**
 * Loads the ESM-only `file-type` package from this CommonJS codebase.
 *
 * @returns {Promise<Object>} The module namespace.
 */
async function loadFileType() {
  if (!fileTypeModule) {
    fileTypeModule = import("file-type");
  }

  return await fileTypeModule;
}

/**
 * Whether the buffer holds an SVG document. `file-type` only knows binary
 * magic numbers; SVG is XML and has to be sniffed as text.
 *
 * @param {Buffer} data - The uploaded bytes.
 * @returns {boolean} True if the bytes start an SVG document.
 */
function looksLikeSvg(data) {
  const head = data
    .subarray(0, SNIFF_BYTES)
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();

  if (!head.startsWith("<")) {
    return false;
  }

  // Skip over the optional XML prologue, comments and the doctype.
  const withoutPrologue = head
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .trimStart();

  return /^<svg[\s>]/i.test(withoutPrologue);
}

/**
 * Confirms that the bytes really decode as the detected image type, and reads
 * the dimensions the variant presets are measured against.
 *
 * @param {Buffer} data - The uploaded bytes.
 * @param {Object} type - The matched allowlist entry.
 * @returns {Promise<{width: number|null, height: number|null, format: string}>}
 * @throws {BadRequestError} When sharp cannot decode the file.
 */
async function readImageMetadata(data, type) {
  let metadata;

  try {
    metadata = await sharp(data, {
      limitInputPixels: imageMaxPixels(),
    }).metadata();
  } catch (error) {
    throw new BadRequestError("invalid_image", {
      mimeType: type.mimeType,
      message: error?.message,
    });
  }

  if (!type.sharpFormats.includes(metadata.format)) {
    throw new BadRequestError("invalid_image", {
      mimeType: type.mimeType,
      detectedFormat: metadata.format,
    });
  }

  return {
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    format: metadata.format,
  };
}

/**
 * Decides the type of an upload from its content: magic bytes for binary
 * formats, an XML sniff for SVG, and a sharp decode for every image on top.
 *
 * @param {Buffer} data - The uploaded bytes.
 * @returns {Promise<{mimeType: string, kind: string, image: Object|null,
 *   variants: boolean}>}
 * @throws {BadRequestError} On empty files and types outside the allowlist.
 */
async function detectUploadType(data) {
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new BadRequestError("empty_file");
  }

  // SVG has to be sniffed first: it is XML, so `file-type` either reports the
  // generic XML type or nothing at all.
  let mimeType = looksLikeSvg(data) ? SVG_MIME_TYPE : null;

  if (!mimeType) {
    const { fileTypeFromBuffer } = await loadFileType();
    const sniffed = await fileTypeFromBuffer(data.subarray(0, SNIFF_BYTES));
    mimeType = sniffed?.mime || null;
  }

  const type = ALLOWED_TYPES.find((entry) => entry.mimeType === mimeType);

  if (!type) {
    throw new BadRequestError("unsupported_file_type", {
      detectedMimeType: mimeType,
      allowed: ALLOWED_MIME_TYPES,
    });
  }

  const decodable =
    type.kind === MEDIA_KIND.IMAGE && type.sharpFormats.length > 0;

  return {
    mimeType: type.mimeType,
    kind: type.kind,
    image: decodable ? await readImageMetadata(data, type) : null,
    variants: decodable,
  };
}

/**
 * Decides the type of a file that is already in the stock. The allowlist is an
 * upload rule, not a storage rule: the legacy tree holds whatever operators put
 * there over the years, and the media import moves that stock as it is instead
 * of losing it. Files outside the allowlist keep the type their name suggests
 * and become documents; only allowlisted images get a decode check, and only a
 * file sharp actually reads gets variants.
 *
 * @param {Buffer} data - The stored bytes.
 * @param {string} [fileName] - Name the file had in the legacy tree.
 * @returns {Promise<{mimeType: string, kind: string, image: Object|null,
 *   variants: boolean}>}
 * @throws {BadRequestError} On empty files.
 */
async function detectStoredType(data, fileName) {
  try {
    return await detectUploadType(data);
  } catch (error) {
    if (error?.code === "empty_file") {
      throw error;
    }

    const mimeType = mime.lookup(String(fileName || "")) || GENERIC_MIME_TYPE;

    return {
      // An image sharp could not verify is still not one we dare resize; it
      // travels as a document so nothing downstream tries to decode it.
      mimeType,
      kind: MEDIA_KIND.DOCUMENT,
      image: null,
      variants: false,
    };
  }
}

module.exports = {
  ALLOWED_MIME_TYPES,
  ICO_MIME_TYPE,
  SVG_MIME_TYPE,
  detectStoredType,
  detectUploadType,
};
