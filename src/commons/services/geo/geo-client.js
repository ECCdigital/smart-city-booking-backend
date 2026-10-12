/**
 * The one HTTP client of the geo services: every call to a provider of
 * search, reverse search or map tiles goes out here, after the pattern of
 * `keycloak-check/probe-client.js`. 3 s at most per call, for the socket and
 * in total; a redirect is never followed; no HTTP status throws; an answer
 * is read up to a size limit. A call never throws for the network either:
 * no answer in time is the outcome `timeout`, no connection (DNS, refused,
 * TLS) or an answer above the limit the outcome `unreachable`.
 *
 * Only what the caller names goes out: the URL with its query and the
 * platform's User-Agent (`user-agent.js`). No header of the browser is ever
 * passed through - the client takes none.
 */

const axios = require("axios");

const { geoUserAgent } = require("./user-agent");

/** How long a call may take, socket and in total (spec: 3 s). */
const GEO_TIMEOUT_MS = 5000;

/** The most of an answer a call reads by default, far above a search answer. */
const DEFAULT_MAX_BYTES = 256 * 1024;

/** The axios codes of a request that got no answer in time. */
const TIMEOUT_CODES = new Set(["ECONNABORTED", "ETIMEDOUT"]);

/**
 * The response headers as a plain object with lower-case names.
 *
 * @param {Object} headers The axios headers
 * @returns {Object<string, string>} The headers
 */
function plainHeaders(headers) {
  const raw =
    typeof headers?.toJSON === "function" ? headers.toJSON() : headers;
  return Object.fromEntries(
    Object.entries(raw || {}).map(([name, value]) => [
      name.toLowerCase(),
      value,
    ]),
  );
}

/**
 * The result of a call:
 *
 *   { outcome: "response", status, headers, data }
 *   { outcome: "timeout" }
 *   { outcome: "unreachable", code }
 *
 * `headers` lower-case, `data` the body as text (or a Buffer for
 * `responseType: "arraybuffer"`).
 *
 * @typedef {Object} GeoCallResult
 */

/**
 * Sends one GET to a geo service.
 *
 * @param {Object} params
 * @param {string} params.url Absolute URL without query
 * @param {Object<string, string|number>} [params.query] Query parameters
 * @param {"text"|"arraybuffer"} [params.responseType="text"] How to read
 *   the body
 * @param {number} [params.maxBytes] The most of an answer to read
 * @returns {Promise<GeoCallResult>} The result, never a rejection for an
 *   HTTP status or the network
 */
async function get({
  url,
  query,
  responseType = "text",
  maxBytes = DEFAULT_MAX_BYTES,
}) {
  const search = query ? `?${new URLSearchParams(query)}` : "";
  try {
    const response = await axios.request({
      method: "GET",
      url: `${url}${search}`,
      headers: { "User-Agent": geoUserAgent() },
      timeout: GEO_TIMEOUT_MS,
      // `timeout` alone is the socket's idle time; this bounds the whole call.
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
      maxRedirects: 0,
      maxContentLength: maxBytes,
      validateStatus: () => true,
      responseType,
    });
    return {
      outcome: "response",
      status: response.status,
      headers: plainHeaders(response.headers),
      data: response.data,
    };
  } catch (error) {
    if (axios.isCancel(error) || TIMEOUT_CODES.has(error?.code)) {
      return { outcome: "timeout" };
    }
    return {
      outcome: "unreachable",
      code: error?.code || error?.cause?.code || "unknown",
    };
  }
}

module.exports = { get, GEO_TIMEOUT_MS };
