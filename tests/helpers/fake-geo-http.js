/**
 * The geo services without a server: the HTTP client every call of the geo
 * module goes out through (`axios.request`, see
 * `src/commons/services/geo/geo-client.js`) replaced by routes per method
 * and URL, after the pattern of `fake-keycloak-http.js`. Everything above
 * the wire - the client's mapping of an answer, a timeout or a network
 * error, the adapter, the cache, the limits, the route - is the production
 * code.
 *
 * A route is `METHOD <origin><path>`, without the query; its answer sees the
 * whole request (query, headers), so one route can answer per parameter.
 * Anything without a route throws and is recorded, and so is a request that
 * would follow a redirect, wait longer than 3 s, read an unbounded answer
 * or go out without an abort signal: `verify()` names them all.
 *
 *   const geo = new FakeGeoHttp().install();
 *   geo.on("GET", `${PHOTON}/api`, json(200, featureCollection([...])));
 *   ...
 *   geo.requests  // [{ method, url, path, query, headers }]
 *   geo.verify(); // in afterEach
 */

const sinon = require("sinon");
const axios = require("axios");

const { AxiosError, AxiosHeaders } = axios;

/** What the spec allows a call to the geo services to wait (3 s). */
const GEO_TIMEOUT_MS = 3000;

const TIMEOUT = Symbol("timeout");
const UNREACHABLE = Symbol("unreachable");

/**
 * A JSON answer, the way Photon sends its results.
 *
 * @param {number} status HTTP status
 * @param {Object} body The JSON body
 * @param {Object} [headers] Further response headers
 * @returns {Object} The answer
 */
function json(status, body, headers = {}) {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

/**
 * A plain answer with a status and a text body, e.g. a throttling 429.
 *
 * @param {number} status HTTP status
 * @param {string} [body] The body
 * @param {Object} [headers] Response headers
 * @returns {Object} The answer
 */
function text(status, body = "", headers = { "content-type": "text/plain" }) {
  return { status, headers, body };
}

/** No answer within the time limit. */
function timeout() {
  return { [TIMEOUT]: true };
}

/**
 * A network error (DNS, refused, TLS).
 *
 * @param {string} [code="ECONNREFUSED"] The error code Node reports
 * @returns {Object} The answer
 */
function unreachable(code = "ECONNREFUSED") {
  return { [UNREACHABLE]: code };
}

/** Lower-cased plain headers of a request config. */
function headersOf(config) {
  const raw =
    config.headers instanceof AxiosHeaders
      ? config.headers.toJSON()
      : config.headers || {};
  return Object.fromEntries(
    Object.entries(raw).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

/**
 * What a request config breaks of the spec's wire rules: never follow a
 * redirect, wait 3 s at most (socket and whole call), bound the answer,
 * never throw on a status.
 */
function wireViolationsOf(config) {
  const violations = [];
  if (config.maxRedirects !== 0) violations.push("follows redirects");
  if (config.timeout !== GEO_TIMEOUT_MS) {
    violations.push(`timeout ${config.timeout}`);
  }
  if (!(config.signal instanceof AbortSignal)) {
    violations.push("no abort signal");
  }
  if (!(config.maxContentLength > 0)) {
    violations.push("unbounded answer");
  }
  if (
    typeof config.validateStatus !== "function" ||
    !config.validateStatus(302) ||
    !config.validateStatus(500)
  ) {
    violations.push("throws on a status");
  }
  return violations;
}

class FakeGeoHttp {
  constructor() {
    /** @type {Map<string, Object|Function>} */
    this.routes = new Map();
    /** Every request with a route, in order. */
    this.requests = [];
    /** Every request the fake refused, as a sentence. */
    this.unexpected = [];
  }

  /**
   * Answers `method url` (without query) with an answer or a function of
   * the request that returns one. A later `on` for the same route replaces
   * the earlier one.
   *
   * @param {string} method HTTP method, e.g. "GET"
   * @param {string} url Absolute URL without query
   * @param {Object|Function} answer `json(...)`, `text(...)`, `timeout()`,
   *   `unreachable(...)`, or `(request) => answer`
   * @returns {FakeGeoHttp} this
   */
  on(method, url, answer) {
    this.routes.set(`${method.toUpperCase()} ${url}`, answer);
    return this;
  }

  /**
   * Puts the fake on the wire for the current test. Restored by
   * `sinon.restore()`.
   *
   * @returns {FakeGeoHttp} this
   */
  install() {
    sinon.stub(axios, "request").callsFake((config) => this.handle(config));
    return this;
  }

  /**
   * Fails with every refused request.
   *
   * @throws {Error} When a request had no route or broke a wire rule
   */
  verify() {
    if (this.unexpected.length > 0) {
      throw new Error(
        `fake geo http refused:\n  ${this.unexpected.join("\n  ")}`,
      );
    }
  }

  /** The axios side: an answer, or the error axios would throw. */
  async handle(config) {
    const method = (config.method || "GET").toUpperCase();
    const parsed = new URL(config.url);
    const path = `${parsed.origin}${parsed.pathname}`;
    const request = {
      method,
      url: config.url,
      path,
      query: Object.fromEntries(parsed.searchParams),
      headers: headersOf(config),
    };

    const violations = wireViolationsOf(config);
    if (violations.length > 0) {
      return this.refuse(`${method} ${config.url}: ${violations.join(", ")}`);
    }

    const route = this.routes.get(`${method} ${path}`);
    if (!route) {
      return this.refuse(`${method} ${config.url}: no route`);
    }

    this.requests.push(request);
    const answer = typeof route === "function" ? route(request) : route;

    if (answer[TIMEOUT]) {
      throw new AxiosError(
        `timeout of ${config.timeout}ms exceeded`,
        AxiosError.ECONNABORTED,
        config,
      );
    }
    if (answer[UNREACHABLE]) {
      const code = answer[UNREACHABLE];
      throw new AxiosError(`connect ${code} ${parsed.host}`, code, config);
    }

    const body = answer.body ?? "";
    if (Buffer.byteLength(body) > config.maxContentLength) {
      throw new AxiosError(
        `maxContentLength size of ${config.maxContentLength} exceeded`,
        AxiosError.ERR_BAD_RESPONSE,
        config,
      );
    }

    return {
      status: answer.status,
      statusText: "",
      headers: new AxiosHeaders(answer.headers || {}),
      data: body,
      config,
      request: {},
    };
  }

  /** Records a refused request and throws, never as an axios error. */
  refuse(sentence) {
    this.unexpected.push(sentence);
    throw new Error(`fake geo http: ${sentence}`);
  }
}

module.exports = {
  FakeGeoHttp,
  json,
  text,
  timeout,
  unreachable,
  GEO_TIMEOUT_MS,
};
