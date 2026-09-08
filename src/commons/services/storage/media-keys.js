const mime = require("mime-types");
const { posix } = require("node:path");

const INSTANCE_PREFIX = "_instance";

/**
 * Guards a single key segment against traversal and separators.
 *
 * @param {string} value - The raw segment.
 * @param {string} label - Field name used in the thrown error.
 * @returns {string} The validated segment.
 */
function safeSegment(value, label) {
  const segment = String(value ?? "").trim();

  if (!segment || segment.includes("/") || segment.includes("\\")) {
    throw new TypeError(`${label} must be a single path segment`);
  }

  if (segment === "." || segment === ".." || segment.includes("..")) {
    throw new TypeError(`${label} must not contain path traversal`);
  }

  return segment;
}

const GENERIC_MIME_TYPE = "application/octet-stream";

/**
 * Resolves the file extension of an upload — the detected MIME type wins,
 * the original file name is the fallback for the generic and unknown types.
 *
 * @param {Object} params
 * @param {string} params.mimeType - MIME type of the file.
 * @param {string} [params.fileName] - Original file name.
 * @returns {string} Extension without leading dot.
 */
function extensionFor({ mimeType, fileName }) {
  const fromMime =
    mimeType && mimeType !== GENERIC_MIME_TYPE
      ? mime.extension(mimeType)
      : false;
  if (fromMime) {
    return fromMime;
  }

  const fromName = fileName ? posix.extname(fileName).replace(/^\./, "") : "";
  return fromName.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
}

/**
 * The storage prefix holding every byte of a single medium.
 * Instance media (no tenant) live under `_instance/`.
 *
 * @param {Object} params
 * @param {string|null} params.tenantId - Tenant of the medium, null for instance media.
 * @param {string} params.mediaId - Id of the medium.
 * @returns {string} `{tenantId}/media/{mediaId}`
 */
function mediaPrefix({ tenantId, mediaId }) {
  const scope = tenantId ? safeSegment(tenantId, "tenantId") : INSTANCE_PREFIX;
  return `${scope}/media/${safeSegment(mediaId, "mediaId")}`;
}

/**
 * Key of the original file of a medium.
 *
 * @param {Object} params
 * @param {string|null} params.tenantId - Tenant of the medium.
 * @param {string} params.mediaId - Id of the medium.
 * @param {string} params.mimeType - MIME type of the file.
 * @param {string} [params.fileName] - Original file name.
 * @returns {string} `{tenantId}/media/{mediaId}/original.{ext}`
 */
function originalKey({ tenantId, mediaId, mimeType, fileName }) {
  const extension = extensionFor({ mimeType, fileName });
  return `${mediaPrefix({ tenantId, mediaId })}/original.${extension}`;
}

/**
 * Key of a generated variant of a medium.
 *
 * @param {Object} params
 * @param {string|null} params.tenantId - Tenant of the medium.
 * @param {string} params.mediaId - Id of the medium.
 * @param {string} params.name - Preset name, e.g. `thumb`.
 * @param {string} params.format - Variant format, e.g. `webp`.
 * @returns {string} `{tenantId}/media/{mediaId}/{name}.{format}`
 */
function variantKey({ tenantId, mediaId, name, format }) {
  return `${mediaPrefix({ tenantId, mediaId })}/${safeSegment(
    name,
    "variant name",
  )}.${safeSegment(format, "variant format")}`;
}

module.exports = {
  INSTANCE_PREFIX,
  extensionFor,
  mediaPrefix,
  originalKey,
  variantKey,
};
