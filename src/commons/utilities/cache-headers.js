/**
 * The cache policies binary endpoints hand out. Whether a resource is public,
 * internal or a booking document is the caller's decision; this helper owns
 * the header names, the validator format and the 304 answer, so the delivery
 * endpoints do not each grow their own copy of it.
 */
const CACHE_POLICY = {
  // Immutable content under a content-addressed route: never revalidated.
  PUBLIC_IMMUTABLE: "public, max-age=31536000, immutable",
  // Cacheable but revalidated against a strong ETag once the age is reached.
  PUBLIC_REVALIDATE: "public, max-age=86400",
  // May sit in a private cache, but every use revalidates.
  PRIVATE_NO_CACHE: "private, no-cache",
  // Never stored anywhere — booking documents.
  PRIVATE_NO_STORE: "private, no-store",
};

/**
 * Whether an `If-None-Match` header matches the entity tag. Handles the
 * wildcard, comma separated lists and weak comparison.
 *
 * @param {string} header - Raw `If-None-Match` value.
 * @param {string} etag - The entity tag of the resource.
 * @returns {boolean} True if the client already holds this entity.
 */
function matchesEtag(header, etag) {
  const candidates = String(header)
    .split(",")
    .map((value) => value.trim());

  if (candidates.includes("*")) {
    return true;
  }

  const weaken = (value) => value.replace(/^W\//, "");
  return candidates.some((value) => weaken(value) === weaken(etag));
}

/**
 * Formats a checksum as a strong entity tag.
 *
 * @param {string} checksum - Checksum of the delivered bytes.
 * @returns {string|null} The quoted entity tag, null without a checksum.
 */
function strongEtag(checksum) {
  return checksum ? `"${checksum}"` : null;
}

/**
 * Writes the caching headers of a binary response and reports whether the
 * client's copy is still current. Callers answer a `true` with `304`.
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {Object} params
 * @param {string} params.cacheControl - One of `CACHE_POLICY`.
 * @param {string} [params.etag] - Entity tag of the delivered bytes.
 * @returns {boolean} True when the response may be a 304.
 */
function applyCacheHeaders(req, res, { cacheControl, etag }) {
  res.setHeader("Cache-Control", cacheControl);

  if (!etag) {
    return false;
  }

  res.setHeader("ETag", etag);

  const ifNoneMatch = (req.headers || {})["if-none-match"];
  return Boolean(ifNoneMatch) && matchesEtag(ifNoneMatch, etag);
}

module.exports = {
  CACHE_POLICY,
  applyCacheHeaders,
  strongEtag,
};
