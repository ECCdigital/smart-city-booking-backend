const axios = require("axios");
const bunyan = require("bunyan");
const BaseAccessApiClient = require("./base-access-api-client");

const DEFAULT_SALTO_SCOPE = "user_api.full_access";
const DEFAULT_SALTO_ENVIRONMENT = "accept";

// The Salto KS environments and their hosts. Accept (sandbox) and production
// are separate installations with their own Connect API and identity server,
// so a tenant picks the environment and the URLs follow from it. Hosts as
// published on developer.saltosystems.com (OpenID concepts, API reference)
// and verified 2026-08-18; each can be overridden by env var in case Salto
// moves one.
const SALTO_ENVIRONMENTS = Object.freeze({
  accept: Object.freeze({
    apiBaseUrl:
      process.env.SALTO_ACCEPT_API_BASE_URL ||
      "https://clp-accept-user.my-clay.com",
    identityUrl:
      process.env.SALTO_ACCEPT_IDENTITY_URL ||
      "https://identity-acc.eu.my-clay.com",
  }),
  production: Object.freeze({
    apiBaseUrl:
      process.env.SALTO_PRODUCTION_API_BASE_URL ||
      "https://connect.my-clay.com",
    identityUrl:
      process.env.SALTO_PRODUCTION_IDENTITY_URL ||
      "https://identity.eu.my-clay.com",
  }),
});

/**
 * The Connect API and identity server of a Salto KS environment.
 *
 * @param {string} [environment] `accept` or `production`; defaults to accept
 * @returns {{environment: string, apiBaseUrl: string, identityUrl: string}}
 * @throws {Error} For an environment Salto does not have
 */
function resolveSaltoEnvironment(environment = DEFAULT_SALTO_ENVIRONMENT) {
  const key = String(environment || DEFAULT_SALTO_ENVIRONMENT).toLowerCase();
  const hosts = SALTO_ENVIRONMENTS[key];
  if (!hosts) {
    throw new Error(
      `Unknown Salto KS environment '${environment}'. Use one of: ${Object.keys(SALTO_ENVIRONMENTS).join(", ")}`,
    );
  }
  return { environment: key, ...hosts };
}

/**
 * The message an upstream error carries in its body, if it has one.
 *
 * The identity server answers a rejected token request with an OAuth error
 * body (`error`, `error_description`); the Connect API with
 * `{ ErrorCode, Message }`. Both say more than the HTTP status, and it is that
 * text an administrator needs to see in the connection test.
 *
 * @param {Error} err An axios error
 * @returns {string|null} The upstream message, or `null` if the body has none
 */
function describeUpstreamError(err) {
  const data = err?.response?.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  if (data.error) {
    return data.error_description
      ? `${data.error}: ${data.error_description}`
      : String(data.error);
  }

  if (data.Message || data.message) {
    return String(data.Message || data.message);
  }

  return null;
}
/**
 * What a failed Salto call means for the open path.
 *
 * Measured contract (docs/research/salto-ks-api-contract.md §9): a rejected
 * OTP answers 400 with `ErrorCode` 3102 and "otp_invalid"; the per-command
 * block after repeated rejections answers 403 with the same `ErrorCode` and
 * "otp_blocked". Any other 403 is a missing right of the system user.
 *
 * @param {Error} err An axios error from the Connect API
 * @returns {"otp_invalid"|"otp_blocked"|"forbidden"|"other"}
 */
function classifySaltoError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const text =
    `${data?.Message || data?.message || ""} ${err?.message || ""}`.toLowerCase();

  if (
    text.includes("otp_blocked") ||
    (status === 403 && data?.ErrorCode === 3102)
  ) {
    return "otp_blocked";
  }

  if (
    text.includes("otp_invalid") ||
    (status === 400 && data?.ErrorCode === 3102)
  ) {
    return "otp_invalid";
  }

  if (status === 403) {
    return "forbidden";
  }

  return "other";
}

/**
 * The list inside a Connect API answer: Salto pages some collections
 * (`{items}`), others come bare or under a named key.
 *
 * @param {*} value A Connect API answer
 * @returns {Array}
 */
function extractSaltoList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return value?.items || value?.data || value?.locks || [];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Refresh the access token this many ms before it actually expires so that
// in-flight requests never run into a token that just became invalid.
const TOKEN_REFRESH_SKEW_MS = 60000;

const logger = bunyan.createLogger({
  name: "salto-ks-api-client.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Client for the Salto KS Connect API.
 *
 * Authentication uses the OpenID Connect token endpoint with the resource
 * owner password grant, which is the flow Salto KS requires for non-interactive
 * backend-server integrations. The client ID/secret are sent as HTTP Basic auth
 * and the predefined KS system user credentials in the request body. The
 * retrieved bearer token is cached in-memory and transparently refreshed
 * shortly before it expires.
 *
 * Resource paths follow the Salto KS Connect API (REST) conventions. The
 * client is bound to one Salto environment (`accept` or `production`), from
 * which both the Connect API base URL and the identity server follow.
 */
class SaltoKsApiClient extends BaseAccessApiClient {
  constructor(
    clientId,
    clientSecret,
    siteId,
    environment = DEFAULT_SALTO_ENVIRONMENT,
    options = {},
  ) {
    const hosts = resolveSaltoEnvironment(environment);
    super(hosts.apiBaseUrl);
    this.environment = hosts.environment;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.siteId = siteId || null;
    this.username = options.username || null;
    this.password = options.password || null;
    this.identityUrl = hosts.identityUrl.replace(/\/$/, "");
    this.scope = options.scope || DEFAULT_SALTO_SCOPE;
    this.defaultTimeout = options.defaultTimeout || 30000;

    this._token = null;
    this._tokenExpiresAt = 0;
    this._tokenRequest = null;
  }

  /**
   * Returns a valid bearer token, requesting (or refreshing) it if needed.
   *
   * The token is kept for its lifetime, so a client that lives on (see
   * `salto-ks-clients`) signs in once per token, not once per call. Calls
   * that need a token while one is being requested wait for that request
   * instead of starting their own.
   *
   * @returns {Promise<string>}
   */
  async _getToken() {
    if (
      this._token &&
      Date.now() < this._tokenExpiresAt - TOKEN_REFRESH_SKEW_MS
    ) {
      return this._token;
    }

    if (!this._tokenRequest) {
      this._tokenRequest = this._signIn().finally(() => {
        this._tokenRequest = null;
      });
    }

    return this._tokenRequest;
  }

  /**
   * @private
   * Requests a new token and keeps it until shortly before it expires.
   * @returns {Promise<string>}
   */
  async _signIn() {
    if (!this.username || !this.password) {
      throw new Error(
        "Salto KS requires a system user (username and password) for the password grant",
      );
    }

    const requestedAt = Date.now();
    const { accessToken, expiresIn } = await this._requestToken();
    this._token = accessToken;
    this._tokenExpiresAt = requestedAt + (expiresIn || 3600) * 1000;
    return this._token;
  }

  /**
   * @private
   * The token request at the identity server: the password grant with the
   * client ID/secret as HTTP Basic auth.
   *
   * @returns {Promise<{accessToken: string, expiresIn: number|undefined}>}
   */
  async _requestToken() {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString(
      "base64",
    );

    const body = new URLSearchParams({
      grant_type: "password",
      username: this.username,
      password: this.password,
      scope: this.scope,
    });

    try {
      const response = await axios.request({
        method: "post",
        url: `${this.identityUrl}/connect/token`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basic}`,
        },
        data: body.toString(),
        timeout: this.defaultTimeout,
      });

      const { access_token: accessToken, expires_in: expiresIn } =
        response.data || {};

      if (!accessToken) {
        throw new Error("Salto KS token endpoint returned no access_token");
      }

      return { accessToken, expiresIn };
    } catch (err) {
      const upstream = describeUpstreamError(err);
      if (upstream) {
        // Keep the axios error (status, response) but say what the identity
        // server actually objected to, not just "status code 400".
        err.message = upstream;
      }
      logger.error(`Salto KS token request failed: ${err.message}`);
      throw err;
    }
  }

  async getSites() {
    return this._request("get", "/v1.2/sites");
  }

  async _resolveSiteId(siteId = this.siteId) {
    if (!siteId) {
      throw new Error("Salto KS siteId is required");
    }

    const normalizedSiteId = String(siteId).trim();
    if (UUID_RE.test(normalizedSiteId)) {
      return normalizedSiteId;
    }

    const sites = this._extractList(await this.getSites());
    const requested = normalizedSiteId.toLowerCase();
    const site = sites.find((item) => {
      return [item.id, item.site_uid, item.customer_reference]
        .filter(Boolean)
        .some((value) => String(value).trim().toLowerCase() === requested);
    });

    if (!site?.id) {
      throw new Error(
        `Salto KS site '${siteId}' was not found. Use the site UUID from /v1.2/sites, or a matching site_uid/customer_reference.`,
      );
    }

    return site.id;
  }

  async getLocks(siteId = this.siteId) {
    const resolvedSiteId = await this._resolveSiteId(siteId);
    return this._request("get", `/v1.2/sites/${resolvedSiteId}/locks`);
  }

  async openLock(lockId, siteId = this.siteId, options = {}) {
    if (siteId && typeof siteId === "object") {
      options = siteId;
      siteId = this.siteId;
    }

    const resolvedSiteId = await this._resolveSiteId(siteId);
    const payload = { locked_state: "unlocked" };
    if (options.otp) {
      payload.otp = options.otp;
    }

    return this._request(
      "patch",
      `/v1.2/sites/${resolvedSiteId}/locks/${lockId}/locking`,
      payload,
    );
  }

  async getIqs(siteId = this.siteId) {
    const resolvedSiteId = await this._resolveSiteId(siteId);
    return this._request("get", `/v1.2/sites/${resolvedSiteId}/iqs`);
  }

  /**
   * The first secret of an IQ, requested without an OTP. Salto hands it out
   * only while the calling system user was never activated at this IQ; the
   * read is single-shot - afterwards the endpoint answers 403.
   *
   * @param {string} iqId Salto IQ UUID
   * @param {string} [siteId]
   * @returns {Promise<string|null>} The 16-character first secret
   */
  async getIqFirstSecret(iqId, siteId = this.siteId) {
    const resolvedSiteId = await this._resolveSiteId(siteId);
    const response = await this._request(
      "get",
      `/v1.2/sites/${resolvedSiteId}/iqs/${iqId}/secret`,
    );
    return response?.secret ?? null;
  }

  async sendIqPinEmail(iqId, siteId = this.siteId) {
    const resolvedSiteId = await this._resolveSiteId(siteId);
    return this._request(
      "get",
      `/v1.2/sites/${resolvedSiteId}/iqs/${iqId}/pin?send_email=true`,
    );
  }

  async putIqPin(iqId, { otp, delta }, siteId = this.siteId) {
    const resolvedSiteId = await this._resolveSiteId(siteId);
    return this._request(
      "put",
      `/v1.2/sites/${resolvedSiteId}/iqs/${iqId}/pin`,
      { otp, delta },
    );
  }

  async getSiteMe(siteId = this.siteId) {
    const resolvedSiteId = await this._resolveSiteId(siteId);
    return this._request("get", `/v1.2/sites/${resolvedSiteId}/me`);
  }

  /**
   * Checks credentials against the identity server and, if a site is
   * configured, the site scope against the Connect API.
   *
   * A failure names what the upstream server objected to (e.g.
   * `invalid_client`) rather than only the HTTP status, so a wrong client
   * secret, a wrong environment and a wrong site can be told apart.
   *
   * @returns {Promise<{success: boolean, message: string}>}
   */
  static async testConnection(
    clientId,
    clientSecret,
    siteId,
    environment = DEFAULT_SALTO_ENVIRONMENT,
    options = {},
  ) {
    let client;
    try {
      client = new SaltoKsApiClient(
        clientId,
        clientSecret,
        siteId,
        environment,
        options,
      );
    } catch (err) {
      return { success: false, message: err.message };
    }

    try {
      // Token request validates the credentials; listing locks validates the
      // site scope when a siteId is configured.
      await client._getToken();
      if (siteId) {
        await client.getLocks(siteId);
      }
      return {
        success: true,
        message: `Connection successful (${client.environment})`,
      };
    } catch (err) {
      const upstream = describeUpstreamError(err);
      if (upstream) {
        return { success: false, message: upstream };
      }
      return BaseAccessApiClient.handleConnectionError(err);
    }
  }

  async _request(method, path, data = null, options = {}) {
    const token = await this._getToken();

    try {
      return await this._send(method, path, data, {
        token,
        timeout: options.timeout || this.defaultTimeout,
      });
    } catch (err) {
      if (err?.response?.status === 401 && this._token === token) {
        // Salto no longer accepts the token before its lifetime is over
        // (e.g. revoked): the next call signs in again instead of reusing it.
        this._token = null;
        this._tokenExpiresAt = 0;
      }
      logger.error(
        `Salto KS API request failed: ${method.toUpperCase()} ${path} - ${err.message}`,
      );
      throw err;
    }
  }

  /**
   * @private
   * The HTTP transport to the Connect API.
   * @returns {Promise<*>} The response body
   */
  async _send(method, path, data, { token, timeout }) {
    const config = {
      method,
      url: `${this.baseUrl}${path}`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      timeout,
    };

    if (data) {
      config.data = data;
    }

    const response = await axios.request(config);
    return response.data;
  }

  _extractList(value) {
    return extractSaltoList(value);
  }
}

module.exports = {
  SaltoKsApiClient,
  SALTO_ENVIRONMENTS,
  DEFAULT_SALTO_ENVIRONMENT,
  DEFAULT_SALTO_SCOPE,
  resolveSaltoEnvironment,
  describeUpstreamError,
  classifySaltoError,
  extractSaltoList,
};
