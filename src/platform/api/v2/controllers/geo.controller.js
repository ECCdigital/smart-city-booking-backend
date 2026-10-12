const GeoService = require("../../../../commons/services/geo/geo-service");
const TileService = require("../../../../commons/services/geo/tile-service");
const ApiResponse = require("../../../../commons/utilities/api-response");
const { CACHE_POLICY } = require("../../../../commons/utilities/cache-headers");

/**
 * Search, reverse search, start view and tiles for the location input (map
 * ECCdigital/tickets#372). Errors go to the central error handler: `400`
 * for a query or tile it cannot read, `503 geo_search_unavailable` or
 * `503 geo_tiles_unavailable` for want of the provider or past a limit.
 */
class GeoControllerV2 {
  /** `GET /api/v2/:tenant/geo/search?q&lat&lon&lang`: at most 5 hits. */
  static async search(req, res) {
    const { q, lat, lon, lang } = req.query;
    const data = await GeoService.search({
      userId: req.principal.userId,
      q,
      lat,
      lon,
      lang,
    });
    return ApiResponse.ok(res, { data });
  }

  /** `GET /api/v2/:tenant/geo/reverse?lat&lon&lang`: one hit or `null`. */
  static async reverse(req, res) {
    const { lat, lon, lang } = req.query;
    const data = await GeoService.reverse({
      userId: req.principal.userId,
      lat,
      lon,
      lang,
    });
    return ApiResponse.ok(res, { data });
  }

  /** `GET /api/v2/:tenant/geo/start`: `{ lat, lon, zoom }` of the map. */
  static async start(req, res) {
    const data = await GeoService.start({ tenantId: req.params.tenant });
    return ApiResponse.ok(res, { data });
  }

  /**
   * `GET /api/v2/:tenant/geo/tiles/:z/:x/:y`: the tile as an image, kept a
   * day by the browser.
   */
  static async tile(req, res) {
    const { z, x, y } = req.params;
    const tile = await TileService.tile({ z, x, y });
    res.set("Content-Type", tile.contentType);
    res.set("Cache-Control", CACHE_POLICY.PRIVATE_DAY);
    return res.status(200).send(tile.data);
  }
}

module.exports = GeoControllerV2;
