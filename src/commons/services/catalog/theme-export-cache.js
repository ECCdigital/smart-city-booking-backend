const crypto = require("crypto");
const NodeCache = require("node-cache");

/**
 * The theme export cache: one entry per Theme Bundle, holding the exported
 * body and the strong `ETag` the client revalidates it with.
 *
 * Freshness is pull-based (storefront ADR 0001): the storefront keeps the
 * bundle it read and asks whether its tag still holds, the backend never
 * calls the storefront and there is no purge endpoint. The entries
 * therefore carry no TTL - they live until a write flushes the cache, and
 * an invalidation empties it whole rather than by key, because a tenant catalog's
 * slug can change in the same write and rebuilding an export is cheap.
 *
 * The media write path is deliberately not an invalidation trigger. Media ids
 * are immutable, and the two fields of a medium that do travel in the bundle -
 * the `width` and `height` an enriched reference carries - are written at
 * upload, before any Hero Layout can name the medium; the save that names it
 * flushes this cache itself. The one write that changes them afterwards is
 * `media-cli backfill-dimensions`, and that runs in its own process, where
 * flushing this cache would empty an empty one. A bundle an instance cached
 * before the backfill therefore keeps `width`/`height: null` until the next
 * catalog or instance write, or a restart - called out in the 4.3 upgrade
 * notes, because no in-process trigger can cover it.
 */

// No TTL and no sweep: `invalidateAll()` is the only thing that ends an entry.
const cache = new NodeCache({ stdTTL: 0, checkperiod: 0 });

// Counts the invalidations, so a build that started before one does not
// store its result after it. Without a TTL such a body would never age out.
let generation = 0;

/** Hex characters of the sha1 digest that make up the tag. */
const ETAG_HEX_LENGTH = 16;

const INSTANCE_KEY = "theme:instance";

/**
 * The strong entity tag of an exported bundle: a truncated sha1 over its
 * JSON. Truncated because the tag is an equality token, not a signature -
 * 64 bits of digest are far past the point where two exports of one
 * instance collide, and a short tag keeps the header small.
 *
 * @param {Object} body - The exported bundle.
 * @returns {string} The quoted strong tag, e.g. `"9f1c0a4d2b8e5f37"`.
 */
function etagOf(body) {
  const digest = crypto
    .createHash("sha1")
    .update(JSON.stringify(body))
    .digest("hex");

  return `"${digest.slice(0, ETAG_HEX_LENGTH)}"`;
}

class ThemeExportCache {
  /**
   * @param {?string} [slug] - The slug catalog's slug, or nothing for the
   *   instance bundle.
   * @returns {string} The cache key of that bundle.
   */
  static keyFor(slug = null) {
    return slug ? `theme:slug:${slug}` : INSTANCE_KEY;
  }

  /**
   * The cached entry of a key, building and tagging it on a miss. A build
   * that throws caches nothing, so a missing catalog stays a 404 rather
   * than a stored one.
   *
   * @param {string} key - From `keyFor`.
   * @param {function(): Promise<Object>} build - Builds the export body.
   * @returns {Promise<{body: Object, etag: string}>} Body and its tag.
   */
  static async remember(key, build) {
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const builtAt = generation;
    const body = await build();
    const entry = { body, etag: etagOf(body) };

    // The write that invalidated while this was building wins: this body is
    // from before it, and storing it now would keep it for good.
    if (generation === builtAt) {
      cache.set(key, entry);
    }

    return entry;
  }

  /** Drops every entry. Called from each write that can change an export. */
  static invalidateAll() {
    generation += 1;
    cache.flushAll();
  }
}

module.exports = { ThemeExportCache };
