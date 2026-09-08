const { posix } = require("node:path");

const { MEDIA_VISIBILITY } = require("../../schemas/mediaSchema");

/**
 * The legacy path of a medium is the place its bytes had in the pre-media-library
 * tree (`public/`, `protected/`) — the value the permanent resolver route
 * `GET /files/get?name=` looks a medium up by (§4.10 of the media spec).
 *
 * Everything here is deliberately host-independent: stored legacy URLs have the
 * host of the environment they were uploaded in baked in, so only the path and
 * the `name` parameter decide whether an address is ours.
 */

// The two roots of the legacy tree. They are the whole of the visibility
// information the old world had.
const PUBLIC_ROOT = "public";
const PROTECTED_ROOT = "protected";

// The two trees that become library media. Everything else in the legacy world
// is a booking document tree, placed by its booking rather than by its folder.
const LEGACY_ROOTS = Object.freeze([PUBLIC_ROOT, PROTECTED_ROOT]);

// `/api/files/get` for the instance, `/api/{tenant}/files/get` for a tenant.
const LEGACY_ROUTE = /^\/api\/(?:([^/]+)\/)?files\/get$/;

/**
 * Brings a stored legacy path into the one form the resolver stores and looks
 * up: a single leading slash, no traversal, no trailing slash.
 *
 * @param {string} value - Raw path from a URL parameter or a directory listing.
 * @returns {string|null} The normalised path, or null when it is unusable.
 */
function normaliseLegacyPath(value) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return null;
  }

  const normalised = posix.normalize(`/${raw}`).replace(/\/+$/, "");

  // `normalize` resolves what it can; a leading `..` survives and would climb
  // out of the tree.
  if (normalised.startsWith("/..") || normalised === "/") {
    return null;
  }

  return normalised;
}

/**
 * The first segment of a legacy path — `public`, `protected`, `receipts` and so
 * on.
 *
 * @param {string} legacyPath - A normalised legacy path.
 * @returns {string} The root segment, empty when there is none.
 */
function legacyRoot(legacyPath) {
  return String(legacyPath ?? "").split("/")[1] || "";
}

/**
 * Reads a stored address as a legacy file reference. Only the path and the
 * `name` parameter are consulted — an absolute URL from a long-gone host
 * resolves exactly like the relative form.
 *
 * @param {string} value - A stored URL or path.
 * @returns {{tenantId: string|null, legacyPath: string}|null} The reference, or
 *   null when the address does not point at the legacy file route.
 */
function parseLegacyUrl(value) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return null;
  }

  let url;

  try {
    // The base only serves to make relative addresses parseable; it never ends
    // up in the result.
    url = new URL(raw, "http://legacy.invalid");
  } catch {
    return null;
  }

  const route = LEGACY_ROUTE.exec(url.pathname);

  if (!route) {
    return null;
  }

  const legacyPath = normaliseLegacyPath(url.searchParams.get("name"));

  if (!legacyPath) {
    return null;
  }

  return { tenantId: route[1] || null, legacyPath };
}

/**
 * The tags an imported medium gets from its place in the tree: every folder
 * between the root and the file. The media library is flat — folders survive as
 * tags, nothing else (§4.10).
 *
 * @param {string} legacyPath - A normalised legacy path.
 * @returns {string[]} The folder names, outermost first.
 */
function legacyTags(legacyPath) {
  return String(legacyPath ?? "")
    .split("/")
    .slice(2, -1)
    .filter(Boolean);
}

/**
 * The visibility an imported medium gets from the tree it lay in. Anything
 * outside `public/` is treated as internal — the safe reading for a tree whose
 * only other root was `protected/`.
 *
 * @param {string} legacyPath - A normalised legacy path.
 * @returns {string} One of {@link MEDIA_VISIBILITY}.
 */
function legacyVisibility(legacyPath) {
  return legacyRoot(legacyPath) === PUBLIC_ROOT
    ? MEDIA_VISIBILITY.PUBLIC
    : MEDIA_VISIBILITY.INTERN;
}

/**
 * The file name of a legacy path.
 *
 * @param {string} legacyPath - A normalised legacy path.
 * @returns {string}
 */
function legacyFileName(legacyPath) {
  return posix.basename(String(legacyPath ?? ""));
}

module.exports = {
  LEGACY_ROOTS,
  PROTECTED_ROOT,
  PUBLIC_ROOT,
  legacyFileName,
  legacyRoot,
  legacyTags,
  legacyVisibility,
  normaliseLegacyPath,
  parseLegacyUrl,
};
