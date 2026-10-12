/**
 * The adapter for the map tiles of TopPlusOpen (BKG) in Web Mercator: one
 * tile by `z/x/y`, fetched over the URL template of
 * `GEO_TILES_URL_TEMPLATE` (`{z}`, `{x}` and `{y}` replaced), the public
 * service of the BKG by default. Only the tile and the platform's
 * User-Agent go out (`geo-client.js`).
 *
 * Only an image counts as a tile: a PNG, JPEG or WebP with bytes. An SVG is
 * no tile, it could carry script under the platform's origin.
 *
 * `tile` never throws: the answer is `{ ok: true, tile: { contentType,
 * data } }` or `{ ok: false, failure }` with `failure` one of `timeout`,
 * `unreachable`, `throttled`, `status` and `invalid`.
 */

const GeoClient = require("./geo-client");

const DEFAULT_TEMPLATE =
  "https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/{z}/{y}/{x}.png";

/** The zoom levels of the tile matrix set WEBMERCATOR of TopPlusOpen. */
const ZOOM_RANGE = { min: 0, max: 18 };

/** The most of a tile read; a tile of TopPlusOpen is some 10 to 60 KiB. */
const MAX_TILE_BYTES = 1024 * 1024;

/** The media types of a tile. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const template = () => process.env.GEO_TILES_URL_TEMPLATE || DEFAULT_TEMPLATE;

const urlOf = ({ z, x, y }) =>
  template()
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y));

/** The media type of a `Content-Type` header, lower case, without params. */
const mediaTypeOf = (header) =>
  String(header || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

/**
 * Fetches one tile.
 *
 * @param {Object} params
 * @param {number} params.z Zoom level
 * @param {number} params.x Column
 * @param {number} params.y Row
 * @returns {Promise<{ok: true, tile: {contentType: string, data: Buffer}}|{ok: false, failure: string}>}
 */
async function tile({ z, x, y }) {
  const result = await GeoClient.get({
    url: urlOf({ z, x, y }),
    responseType: "arraybuffer",
    maxBytes: MAX_TILE_BYTES,
  });
  if (result.outcome !== "response") {
    return { ok: false, failure: result.outcome };
  }
  if (result.status === 429) return { ok: false, failure: "throttled" };
  if (result.status !== 200) return { ok: false, failure: "status" };

  const contentType = mediaTypeOf(result.headers["content-type"]);
  const data = Buffer.from(result.data ?? "");
  if (!IMAGE_TYPES.has(contentType) || data.length === 0) {
    return { ok: false, failure: "invalid" };
  }
  return { ok: true, tile: { contentType, data } };
}

module.exports = { tile, ZOOM_RANGE };
