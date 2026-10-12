/**
 * The tile proxy of the map (map ECCdigital/tickets#372): the browser loads
 * the tiles of the location input here, so the tile server sees the
 * platform's server, never an admin. A tile is the same for every tenant
 * and person, so the cache is keyed by `z/x/y` alone.
 *
 * Order of a request: check the tile (400), then the cache, then the limit
 * of the instance towards the tile server (misses only), then the adapter
 * (`topplus-adapter.js`). Only a tile is kept; a full cache keeps nothing
 * and the tile still goes out. There is no limit per person: one map view
 * loads dozens of tiles.
 *
 * The logs name kinds and counts of failures, never the coordinates of a
 * tile, and neither does an error: what a person looked at stays theirs.
 */

const NodeCache = require("node-cache");

const TopPlusAdapter = require("./topplus-adapter");
const { consume, unavailable, remember } = require("./provider-rules");
const { geoTilesOutbound, positiveInt } = require("../rate-limit/limits");
const { BadRequestError } = require("../../../errors/BaseError");

/** The code of every refusal of a tile for want of the tile server. */
const TILES_UNAVAILABLE = "geo_tiles_unavailable";
/** The code of a `z/x/y` that names no tile of the service. */
const TILE_INVALID = "geo_tile_invalid";

/** Defaults of the tile cache: 7 days, 2000 tiles (some 50 to 100 MiB). */
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_MAX_TILES = 2000;

/**
 * The tile cache, made on first use with `GEO_TILES_CACHE_TTL_SECONDS` and
 * `GEO_TILES_CACHE_MAX_TILES`.
 */
let cache = null;

function tileCache() {
  if (!cache) {
    cache = new NodeCache({
      stdTTL: positiveInt("GEO_TILES_CACHE_TTL_SECONDS", DEFAULT_TTL_SECONDS),
      maxKeys: positiveInt("GEO_TILES_CACHE_MAX_TILES", DEFAULT_MAX_TILES),
      checkperiod: 600,
      useClones: false,
    });
  }
  return cache;
}

/**
 * A coordinate of the route: digits only, within `0 … max`.
 *
 * @throws {BadRequestError} `geo_tile_invalid`
 */
function coordinateOf(value, max) {
  const number = /^\d{1,10}$/.test(String(value)) ? Number(value) : NaN;
  if (!Number.isInteger(number) || number > max) {
    throw new BadRequestError(TILE_INVALID);
  }
  return number;
}

/**
 * The tile of the route: a zoom within the range of the service, `x` and
 * `y` within `0 … 2^z − 1`.
 *
 * @throws {BadRequestError} `geo_tile_invalid`
 */
function tileOf({ z, x, y }) {
  const { min, max } = TopPlusAdapter.ZOOM_RANGE;
  const zoom = coordinateOf(z, max);
  if (zoom < min) throw new BadRequestError(TILE_INVALID);
  const last = 2 ** zoom - 1;
  return { z: zoom, x: coordinateOf(x, last), y: coordinateOf(y, last) };
}

class TileService {
  /**
   * One tile of the map.
   *
   * @param {Object} params The route parameters, as text
   * @param {string} params.z Zoom level
   * @param {string} params.x Column
   * @param {string} params.y Row
   * @returns {Promise<{contentType: string, data: Buffer}>} The tile
   * @throws {BadRequestError} `geo_tile_invalid`
   * @throws {ServiceUnavailableError} `geo_tiles_unavailable`
   */
  static async tile({ z, x, y }) {
    const wanted = tileOf({ z, x, y });
    const key = `${wanted.z}/${wanted.x}/${wanted.y}`;

    const cached = tileCache().get(key);
    if (cached !== undefined) return cached;

    await consume({
      limit: geoTilesOutbound(),
      code: TILES_UNAVAILABLE,
      kind: "tiles",
      name: "outbound",
    });

    const answer = await TopPlusAdapter.tile(wanted);
    if (!answer.ok) {
      throw unavailable({
        code: TILES_UNAVAILABLE,
        kind: "tiles",
        failure: answer.failure,
      });
    }
    remember(tileCache(), key, answer.tile);
    return answer.tile;
  }

  /** Forgets every tile and reads the cache settings anew. For tests. */
  static clearCache() {
    if (cache) {
      cache.flushAll();
      cache.close();
    }
    cache = null;
  }
}

module.exports = TileService;
module.exports.TILES_UNAVAILABLE = TILES_UNAVAILABLE;
