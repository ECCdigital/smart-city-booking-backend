/**
 * Keycloak (and the Storefront) without a server: the HTTP client every probe
 * of „Realm prüfen“ sends through (`axios.request`, see
 * `src/commons/services/keycloak-check/probe-client.js`) replaced by routes
 * per method and URL. Everything above the wire - the probe client's mapping
 * of an answer, a timeout or a network error, the row evaluators, the
 * endpoint - is the production code.
 *
 * A route is `METHOD <origin><path>`, without the query; its answer sees the
 * whole request (query, form, headers), so one route can answer per
 * parameter. Anything without a route throws and is recorded, and so is a
 * request that would follow a redirect, wait longer than 5 s or read a page
 * as anything but text: `verify()` names them all.
 *
 *   const keycloak = new FakeKeycloakHttp().install();
 *   keycloak.on("GET", `${ISSUER}/.well-known/openid-configuration`,
 *     json(200, discoveryDocument(ISSUER)));
 *   keycloak.on("POST", `${ISSUER}/protocol/openid-connect/token`, (req) =>
 *     req.form.client_id === "booking-client"
 *       ? json(400, { error: "invalid_grant" })
 *       : json(401, { error: "invalid_client" }));
 *   ...
 *   keycloak.requests  // [{ method, url, path, query, form, headers }]
 *   keycloak.verify(); // in afterEach
 */

const sinon = require("sinon");
const axios = require("axios");

const { AxiosError, AxiosHeaders } = axios;

/** What the contract allows a probe to wait (5 s). */
const PROBE_TIMEOUT_MS = 5000;

const TIMEOUT = Symbol("timeout");
const UNREACHABLE = Symbol("unreachable");

/**
 * A JSON answer, the way Keycloak sends its endpoints' answers and errors.
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
 * An HTML page, e.g. Keycloak's error page. Its text is never to be read,
 * so it carries words a check must not find.
 *
 * @param {number} status HTTP status
 * @param {Object} [headers] Further response headers
 * @returns {Object} The answer
 */
function html(status, headers = {}) {
  return {
    status,
    headers: { "content-type": "text/html;charset=utf-8", ...headers },
    body: '<html><body>{"issuer":"page text","error":"page text"}</body></html>',
  };
}

/**
 * A redirect. The probe must not follow it.
 *
 * @param {string} location The `Location` header
 * @param {number} [status=302] HTTP status
 * @returns {Object} The answer
 */
function redirect(location, status = 302) {
  return { status, headers: { location }, body: "" };
}

/** No answer within the probe's time limit. */
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

/**
 * The discovery document of a realm as Keycloak serves it, cut to the
 * fields a check could read.
 *
 * @param {string} issuer The realm's issuer, `<serverUrl>/realms/<realm>`
 * @returns {Object} The document
 */
function discoveryDocument(issuer) {
  const oidc = `${issuer}/protocol/openid-connect`;
  return {
    issuer,
    authorization_endpoint: `${oidc}/auth`,
    token_endpoint: `${oidc}/token`,
    introspection_endpoint: `${oidc}/token/introspect`,
    end_session_endpoint: `${oidc}/logout`,
  };
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

/** A form body as an object, `null` without one. */
function formOf(config) {
  if (config.data === undefined || config.data === null) return null;
  return Object.fromEntries(new URLSearchParams(String(config.data)));
}

/**
 * What a request config breaks of the contract's wire rules: never follow
 * a redirect, wait 5 s at most, never throw on a status, read the body as
 * text (a page is never parsed by the client).
 */
function wireViolationsOf(config) {
  const violations = [];
  if (config.maxRedirects !== 0) violations.push("follows redirects");
  if (config.timeout !== PROBE_TIMEOUT_MS) {
    violations.push(`timeout ${config.timeout}`);
  }
  if (
    typeof config.validateStatus !== "function" ||
    !config.validateStatus(302) ||
    !config.validateStatus(500)
  ) {
    violations.push("throws on a status");
  }
  if (config.responseType !== "text") {
    violations.push(`responseType ${config.responseType}`);
  }
  return violations;
}

class FakeKeycloakHttp {
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
   * @param {Object|Function} answer `json(...)`, `html(...)`,
   *   `redirect(...)`, `timeout()`, `unreachable(...)`, or
   *   `(request) => answer`
   * @returns {FakeKeycloakHttp} this
   */
  on(method, url, answer) {
    this.routes.set(`${method.toUpperCase()} ${url}`, answer);
    return this;
  }

  /**
   * Puts the fake on the wire for the current test. Restored by
   * `sinon.restore()`.
   *
   * @returns {FakeKeycloakHttp} this
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
        `fake keycloak http refused:\n  ${this.unexpected.join("\n  ")}`,
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
      form: formOf(config),
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

    return {
      status: answer.status,
      statusText: "",
      headers: new AxiosHeaders(answer.headers || {}),
      data: answer.body ?? "",
      config,
      request: {},
    };
  }

  /** Records a refused request and throws, never as an axios error. */
  refuse(sentence) {
    this.unexpected.push(sentence);
    throw new Error(`fake keycloak http: ${sentence}`);
  }
}

module.exports = {
  FakeKeycloakHttp,
  json,
  html,
  redirect,
  timeout,
  unreachable,
  discoveryDocument,
  PROBE_TIMEOUT_MS,
};
