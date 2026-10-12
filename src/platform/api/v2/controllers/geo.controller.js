const GeoService = require("../../../../commons/services/geo/geo-service");
const ApiResponse = require("../../../../commons/utilities/api-response");

/**
 * Search and reverse search for the location input (map
 * ECCdigital/tickets#372). Errors go to the central error handler: `400`
 * for a query it cannot read, `503 geo_search_unavailable` for want of the
 * provider or past a limit.
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
}

module.exports = GeoControllerV2;
