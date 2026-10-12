/**
 * The geo services of the platform (map ECCdigital/tickets#372): search and
 * reverse search for the location input of the Admin UI, answered by a
 * provider behind an adapter (`photon-adapter.js`). What goes out is the
 * search text, the rounded focus or point and the platform's User-Agent,
 * nothing of the person asking.
 *
 * Every request rounds first - the focus of a search to 0.1°, the point of
 * a reverse search to 5 decimals - and then asks the cache, so close
 * requests share one entry and the provider never sees the exact point.
 * The logs name counts and kinds of requests and failures, never a search
 * text or a point.
 */

const bunyan = require("bunyan");
const NodeCache = require("node-cache");

const PhotonAdapter = require("./photon-adapter");
const { BookableManager } = require("../../data-managers/bookable-manager");
const EventManager = require("../../data-managers/event-manager");
const AccessPointManager = require("../../data-managers/access-point-manager");
const RateLimiter = require("../rate-limit/rate-limiter");
const { geoPerUser, geoOutbound } = require("../rate-limit/limits");
const {
  BadRequestError,
  ServiceUnavailableError,
} = require("../../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "geo-service.js",
  level: process.env.LOG_LEVEL,
});

/** The code of every refusal of search and reverse search for want of the service. */
const SEARCH_UNAVAILABLE = "geo_search_unavailable";

/** The most hits a search answers. */
const MAX_HITS = 5;
const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 200;
const DEFAULT_LANG = "de";

/**
 * Answers of search and reverse search, 24 h each. Bounded, so a flood of
 * distinct searches cannot fill the memory: a full cache keeps no new
 * answer, it still answers.
 */
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_MAX_KEYS = 10000;
const cache = new NodeCache({
  stdTTL: CACHE_TTL_SECONDS,
  checkperiod: 600,
  maxKeys: CACHE_MAX_KEYS,
  useClones: false,
});

/** Keeps an answer unless the cache is full. */
function remember(key, value) {
  try {
    cache.set(key, value);
  } catch {
    // ECACHEFULL: answered, not kept.
  }
}

/** The zoom of the start view on the tenant's points: a town. */
const START_ZOOM = 12;

/**
 * The start view of a tenant without a single point: all of Germany.
 * Zoom 5 keeps the whole country inside a small map of about 300 px.
 */
const GERMANY = { lat: 51.2, lon: 9.4, zoom: 5 };

/** A stored `points` value that is a point: `[lon, lat]` within range. */
const isPoint = (points) =>
  Array.isArray(points) &&
  points.length === 2 &&
  points.every(Number.isFinite) &&
  Math.abs(points[0]) <= 180 &&
  Math.abs(points[1]) <= 90;

/** The median of a non-empty list of numbers. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The provider of search and reverse search. */
const geocoder = () => PhotonAdapter;

const round = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * A coordinate of the query: a number within `±limit`, `undefined` when
 * absent.
 *
 * @throws {BadRequestError} `geo_point_invalid`
 */
function coordinateOf(value, limit) {
  if (value === undefined || value === "") return undefined;
  const number = typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(number) || Math.abs(number) > limit) {
    throw new BadRequestError("geo_point_invalid");
  }
  return number;
}

/**
 * The point of a query, rounded to `decimals`; `null` without one.
 *
 * @throws {BadRequestError} `geo_point_invalid` for half a point or a value
 *   out of range
 */
function pointOf({ lat, lon }, decimals) {
  const latitude = coordinateOf(lat, 90);
  const longitude = coordinateOf(lon, 180);
  if (latitude === undefined && longitude === undefined) return null;
  if (latitude === undefined || longitude === undefined) {
    throw new BadRequestError("geo_point_invalid");
  }
  return { lat: round(latitude, decimals), lon: round(longitude, decimals) };
}

/** The language of the names: two letters, `de` otherwise. */
const languageOf = (lang) =>
  typeof lang === "string" && /^[a-z]{2}$/i.test(lang)
    ? lang.toLowerCase()
    : DEFAULT_LANG;

/**
 * The search text, its whitespace collapsed.
 *
 * @throws {BadRequestError} `geo_query_invalid`
 */
function queryOf(q) {
  const text = typeof q === "string" ? q.trim().replace(/\s+/g, " ") : "";
  if (text.length < MIN_QUERY_LENGTH || text.length > MAX_QUERY_LENGTH) {
    throw new BadRequestError("geo_query_invalid");
  }
  return text;
}

/**
 * Counts one attempt against a limit of the geo services.
 *
 * @param {string} kind `search` or `reverse`, for the log
 * @param {string} name `perUser` or `outbound`, for the log
 * @param {Object} limit A limit of `limits.js`
 * @throws {ServiceUnavailableError} `geo_search_unavailable` past the limit
 */
async function consume(kind, name, limit) {
  const slot = await RateLimiter.consume(limit);
  if (!slot.allowed) {
    logger.warn({ kind, limit: name }, "geo limit reached");
    throw new ServiceUnavailableError(SEARCH_UNAVAILABLE, {
      retryAfterSeconds: slot.retryAfterSeconds,
    });
  }
}

/**
 * The answer of the cache, else of the provider within the limit of the
 * instance; a found answer is kept, a failure is not.
 *
 * @param {string} kind `search` or `reverse`
 * @param {string} key The cache key
 * @param {() => Promise<Object>} ask Asks the provider
 * @param {(hits: Object[]) => *} pick What of the hits to answer and keep
 */
async function cachedOrAsked(kind, key, ask, pick) {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  await consume(kind, "outbound", geoOutbound());
  const value = pick(hitsOf(kind, await ask()));
  remember(key, value);
  return value;
}

/**
 * The hits of the provider, or the refusal for want of it.
 *
 * @throws {ServiceUnavailableError} `geo_search_unavailable`
 */
function hitsOf(kind, answer) {
  if (!answer.ok) {
    logger.warn({ kind, failure: answer.failure }, "geo provider failed");
    throw new ServiceUnavailableError(SEARCH_UNAVAILABLE);
  }
  return answer.hits;
}

class GeoService {
  /**
   * Searches an address.
   *
   * @param {Object} params
   * @param {string} params.userId The person asking, for their limit
   * @param {string} params.q The search text, at least 3 characters
   * @param {string} [params.lat] Latitude of the focus
   * @param {string} [params.lon] Longitude of the focus
   * @param {string} [params.lang] Language of the names, `de` by default
   * @returns {Promise<Object[]>} At most 5 hits in the form of a stored
   *   location
   * @throws {BadRequestError} `geo_query_invalid`, `geo_point_invalid`
   * @throws {ServiceUnavailableError} `geo_search_unavailable`
   */
  static async search({ userId, q, lat, lon, lang }) {
    const query = queryOf(q);
    const focus = pointOf({ lat, lon }, 1);
    const language = languageOf(lang);
    await consume("search", "perUser", geoPerUser(userId));

    const key = JSON.stringify([
      "search",
      query.toLowerCase(),
      focus?.lat ?? null,
      focus?.lon ?? null,
      language,
    ]);
    return cachedOrAsked(
      "search",
      key,
      () =>
        geocoder().search({
          q: query,
          focus,
          lang: language,
          limit: MAX_HITS,
        }),
      (hits) => hits,
    );
  }

  /**
   * Finds the address at a point.
   *
   * @param {Object} params
   * @param {string} params.userId The person asking, for their limit
   * @param {string} params.lat Latitude
   * @param {string} params.lon Longitude
   * @param {string} [params.lang] Language of the names, `de` by default
   * @returns {Promise<?Object>} The hit in the form of a stored location, or
   *   `null`
   * @throws {BadRequestError} `geo_point_invalid`
   * @throws {ServiceUnavailableError} `geo_search_unavailable`
   */
  static async reverse({ userId, lat, lon, lang }) {
    const point = pointOf({ lat, lon }, 5);
    if (!point) throw new BadRequestError("geo_point_invalid");
    const language = languageOf(lang);
    await consume("reverse", "perUser", geoPerUser(userId));

    const key = JSON.stringify(["reverse", point.lat, point.lon, language]);
    return cachedOrAsked(
      "reverse",
      key,
      () => geocoder().reverse({ point, lang: language }),
      (hits) => hits[0] ?? null,
    );
  }

  /**
   * The start view of the map of a tenant: the median per axis of every
   * point of its bookables, events and access points at the zoom of a
   * town, all of Germany without one. Computed afresh on every call, from
   * the points alone.
   *
   * @param {Object} params
   * @param {string} params.tenantId The tenant
   * @returns {Promise<{lat: number, lon: number, zoom: number}>}
   */
  static async start({ tenantId }) {
    const stored = (
      await Promise.all([
        BookableManager.getLocationPoints(tenantId),
        EventManager.getLocationPoints(tenantId),
        AccessPointManager.getLocationPoints(tenantId),
      ])
    ).flat();
    const points = stored.filter(isPoint);
    if (points.length === 0) return { ...GERMANY };
    return {
      lat: median(points.map(([, lat]) => lat)),
      lon: median(points.map(([lon]) => lon)),
      zoom: START_ZOOM,
    };
  }

  /** Forgets every cached answer. For tests. */
  static clearCache() {
    cache.flushAll();
  }
}

module.exports = GeoService;
module.exports.SEARCH_UNAVAILABLE = SEARCH_UNAVAILABLE;
