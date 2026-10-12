/**
 * The adapter for Photon (komoot): search and reverse search, its GeoJSON
 * answers mapped onto the form of a stored location (glossary „Standort“):
 *
 *   {
 *     address: { street, house_number, postcode, city, country_code },
 *     coordinates: { type: "Point", points: [lon, lat] },
 *     display_address,
 *   }
 *
 * A missing field is `null`. A place without a house address, e.g. a park,
 * has no `address.street` and carries its name in `display_address`. A
 * second provider would be a second adapter with the same two functions.
 *
 * Neither function throws: the answer is `{ ok: true, hits }` or
 * `{ ok: false, failure }` with `failure` one of `timeout`, `unreachable`,
 * `throttled`, `status` and `invalid`.
 */

const GeoClient = require("./geo-client");
const { failureOf } = require("./provider-rules");

const DEFAULT_BASE_URL = "https://photon.komoot.io";

/** The languages Photon names results in; any other asks for `default`. */
const LANGUAGES = new Set(["de", "en", "fr", "it"]);

/** Photon types whose name is the town itself. */
const TOWN_TYPES = new Set(["city", "town", "village", "locality", "district"]);

const baseUrl = () =>
  (process.env.GEOCODER_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

const languageOf = (lang) => (LANGUAGES.has(lang) ? lang : "default");

const textOf = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * One Photon feature as a hit, `null` for one without a usable point.
 *
 * @param {Object} feature A GeoJSON feature of Photon
 * @returns {?Object} The hit
 */
function hitOf(feature) {
  const [lon, lat] = feature?.geometry?.coordinates ?? [];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const p = feature.properties ?? {};
  const name = textOf(p.name);
  const isStreet = p.type === "street";
  const isTown = TOWN_TYPES.has(p.type);
  const street = textOf(p.street) ?? (isStreet ? name : null);
  const houseNumber = textOf(p.housenumber);
  const postcode = textOf(p.postcode);
  const city = textOf(p.city) ?? (isTown ? name : null);
  const countryCode = textOf(p.countrycode)?.toUpperCase() ?? null;

  const placeName = !street && name && name !== city ? name : null;
  const display = [
    placeName,
    [street, houseNumber].filter(Boolean).join(" "),
    [postcode, city].filter(Boolean).join(" "),
  ].filter(Boolean);

  return {
    address: {
      street,
      house_number: houseNumber,
      postcode,
      city,
      country_code: countryCode,
    },
    coordinates: { type: "Point", points: [lon, lat] },
    display_address: display.join(", "),
  };
}

/**
 * Asks Photon and maps its answer.
 *
 * @param {string} path `api` or `reverse`
 * @param {Object} query The query
 * @returns {Promise<{ok: true, hits: Object[]}|{ok: false, failure: string}>}
 */
async function ask(path, query) {
  const result = await GeoClient.get({ url: `${baseUrl()}/${path}`, query });
  const failure = failureOf(result);
  if (failure) return { ok: false, failure };

  let features;
  try {
    features = JSON.parse(result.data)?.features;
  } catch {
    features = null;
  }
  if (!Array.isArray(features)) return { ok: false, failure: "invalid" };
  return { ok: true, hits: features.map(hitOf).filter(Boolean) };
}

/**
 * @param {Object} params
 * @param {string} params.q The search text
 * @param {?{lat: number, lon: number}} params.focus Where to rank hits first
 * @param {string} params.lang Language of the names
 * @param {number} params.limit The most hits
 */
async function search({ q, focus, lang, limit }) {
  const answer = await ask("api", {
    q,
    limit,
    lang: languageOf(lang),
    ...(focus ? { lat: focus.lat, lon: focus.lon } : {}),
  });
  return answer.ok ? { ok: true, hits: answer.hits.slice(0, limit) } : answer;
}

/**
 * @param {Object} params
 * @param {{lat: number, lon: number}} params.point The point
 * @param {string} params.lang Language of the names
 */
async function reverse({ point, lang }) {
  const answer = await ask("reverse", {
    lat: point.lat,
    lon: point.lon,
    lang: languageOf(lang),
    limit: 1,
  });
  return answer.ok ? { ok: true, hits: answer.hits.slice(0, 1) } : answer;
}

module.exports = { search, reverse };
