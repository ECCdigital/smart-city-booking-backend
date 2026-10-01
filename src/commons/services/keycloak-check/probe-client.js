/**
 * The one HTTP client of „Realm prüfen“: every probe of every row goes out
 * here, under the contract's wire rules. 5 s at most per probe, in total; a
 * redirect is never followed, it is the answer; no HTTP status throws; the
 * body is read as text and parsed only when the answer says it is JSON, so
 * a page's text is never evaluated. A probe never throws for the network
 * either: no answer in time is the outcome `timeout`, no connection
 * (DNS, refused, TLS) the outcome `unreachable` with Node's error code.
 */

const axios = require("axios");

const { originAndPath } = require("./findings");

/** How long a probe may take, in total (contract: 5 s). */
const PROBE_TIMEOUT_MS = 5000;

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
 * The JSON body of an answer that declares JSON, `null` for anything else
 * (a page, an empty body, broken JSON).
 *
 * @param {Object<string, string>} headers Lower-case response headers
 * @param {string} body The body as text
 * @returns {?Object} The parsed body
 */
function jsonBodyOf(headers, body) {
  if (!/[/+]json\b/i.test(headers["content-type"] || "")) return null;
  try {
    const parsed = JSON.parse(body);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The full URL of a probe: the address plus its query.
 *
 * @param {string} url Absolute URL without query
 * @param {Object<string, string>} [query] Query parameters
 * @returns {string} The URL to request
 */
function urlWithQuery(url, query) {
  if (!query || Object.keys(query).length === 0) return url;
  return `${url}?${new URLSearchParams(query)}`;
}

/**
 * The result of a probe:
 *
 *   { outcome: "response", url, status, headers, data }
 *   { outcome: "timeout", url }
 *   { outcome: "unreachable", url, code }
 *
 * `url` is origin and path of the probed address, `headers` lower-case,
 * `data` the JSON body or `null`.
 *
 * @typedef {Object} ProbeResult
 */

/**
 * Sends one probe.
 *
 * @param {Object} probeRequest
 * @param {string} [probeRequest.method="GET"] HTTP method
 * @param {string} probeRequest.url Absolute URL without query, on the
 *   stored Keycloak-URL or Portal-URL only
 * @param {Object<string, string>} [probeRequest.query] Query parameters
 * @param {Object<string, string>} [probeRequest.form] Form parameters, sent
 *   `application/x-www-form-urlencoded`
 * @param {Object<string, string>} [probeRequest.headers] Request headers,
 *   e.g. `Origin` or `Authorization`
 * @returns {Promise<ProbeResult>} The result, never a rejection for an
 *   HTTP status or the network
 */
async function probe({ method = "GET", url, query, form, headers = {} }) {
  const probed = originAndPath(url);
  try {
    const response = await axios.request({
      method,
      url: urlWithQuery(url, query),
      data: form ? new URLSearchParams(form).toString() : undefined,
      headers: form
        ? { "Content-Type": "application/x-www-form-urlencoded", ...headers }
        : headers,
      timeout: PROBE_TIMEOUT_MS,
      // `timeout` alone is the socket's idle time; this bounds the whole probe.
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      maxRedirects: 0,
      validateStatus: () => true,
      responseType: "text",
    });
    const responseHeaders = plainHeaders(response.headers);
    return {
      outcome: "response",
      url: probed,
      status: response.status,
      headers: responseHeaders,
      data: jsonBodyOf(responseHeaders, response.data),
    };
  } catch (error) {
    if (!axios.isAxiosError(error)) throw error;
    if (axios.isCancel(error) || TIMEOUT_CODES.has(error.code)) {
      return { outcome: "timeout", url: probed };
    }
    return {
      outcome: "unreachable",
      url: probed,
      code: error.code || error.cause?.code || "unknown",
    };
  }
}

module.exports = { probe, PROBE_TIMEOUT_MS };
