const { MEDIA_KIND } = require("../../schemas/mediaSchema");

const MEGABYTE = 1024 * 1024;

const DEFAULT_IMAGE_SIZE_MB = 15;
const DEFAULT_DOCUMENT_SIZE_MB = 50;
// Headroom between the largest media limit and the global express-fileupload
// backstop: the media layer must be the one answering with a 400, the backstop
// only catches uploads no route would ever accept.
const BACKSTOP_HEADROOM_MB = 5;
// Byte size does not bound the decoded pixel count — a small file can still be
// a decompression bomb, so sharp gets its own ceiling.
const DEFAULT_IMAGE_MAX_PIXELS = 50_000_000;
// Container CPU quotas are usually far below the detected core count; a small
// pool keeps upload latency predictable next to the Express event loop.
const DEFAULT_SHARP_CONCURRENCY = 1;

/**
 * Reads a positive number from the environment, falling back on anything
 * unset, unparseable or non-positive.
 *
 * @param {string} name - Name of the environment variable.
 * @param {number} fallback - Value used when the variable is unusable.
 * @returns {number} The configured value.
 */
function positiveNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Largest accepted image upload.
 *
 * @returns {number} Size in bytes.
 */
function maxImageBytes() {
  return (
    positiveNumber("MEDIA_MAX_IMAGE_SIZE_MB", DEFAULT_IMAGE_SIZE_MB) * MEGABYTE
  );
}

/**
 * Largest accepted document upload.
 *
 * @returns {number} Size in bytes.
 */
function maxDocumentBytes() {
  return (
    positiveNumber("MEDIA_MAX_DOCUMENT_SIZE_MB", DEFAULT_DOCUMENT_SIZE_MB) *
    MEGABYTE
  );
}

/**
 * The upload limit that applies to a media kind.
 *
 * @param {string} kind - `image` or `document`.
 * @returns {number} Size in bytes.
 */
function maxBytesForKind(kind) {
  return kind === MEDIA_KIND.IMAGE ? maxImageBytes() : maxDocumentBytes();
}

/**
 * The most generous media limit — nothing above this is accepted whatever the
 * upload turns out to be.
 *
 * @returns {number} Size in bytes.
 */
function largestMediaLimitBytes() {
  return Math.max(maxImageBytes(), maxDocumentBytes());
}

/**
 * Global upload backstop for `express-fileupload`, applying to every upload
 * route of the instance. Deliberately above the largest media limit so media
 * uploads fail with a proper 400 instead of a truncated request.
 *
 * @returns {number} Size in bytes.
 */
function uploadBackstopBytes() {
  const largestLimit = Math.max(maxImageBytes(), maxDocumentBytes());
  const configured = positiveNumber("MEDIA_UPLOAD_BACKSTOP_SIZE_MB", 0);

  // A configured backstop below a media limit would truncate uploads the media
  // layer still accepts, so it is only ever raised, never lowered.
  return Math.max(
    largestLimit + BACKSTOP_HEADROOM_MB * MEGABYTE,
    configured * MEGABYTE,
  );
}

/**
 * Pixel ceiling handed to sharp when decoding an upload.
 *
 * @returns {number} Number of pixels.
 */
function imageMaxPixels() {
  return positiveNumber("MEDIA_IMAGE_MAX_PIXELS", DEFAULT_IMAGE_MAX_PIXELS);
}

/**
 * Size of the libvips thread pool.
 *
 * @returns {number} Number of threads.
 */
function sharpConcurrency() {
  return positiveNumber("MEDIA_SHARP_CONCURRENCY", DEFAULT_SHARP_CONCURRENCY);
}

module.exports = {
  imageMaxPixels,
  largestMediaLimitBytes,
  maxBytesForKind,
  sharpConcurrency,
  uploadBackstopBytes,
};
