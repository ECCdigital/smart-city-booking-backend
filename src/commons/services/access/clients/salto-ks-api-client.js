const axios = require("axios");
const bunyan = require("bunyan");
const BaseAccessApiClient = require("./base-access-api-client");

const DEFAULT_SALTO_API_BASE_URL = "https://clp-accept-user.saltoks.com";
const DEFAULT_SALTO_IDENTITY_URL = "https://identity.eu.my-clay.com";
const DEFAULT_SALTO_SCOPE = "user_api.full_access";
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
 * identity server and Connect API base URL are configurable so the same
 * client works against the accept/sandbox and production environments.
 */
class SaltoKsApiClient extends BaseAccessApiClient {
  constructor(
    clientId,
    clientSecret,
    siteId,
    apiBaseUrl = DEFAULT_SALTO_API_BASE_URL,
    options = {},
  ) {
    super(apiBaseUrl || DEFAULT_SALTO_API_BASE_URL);
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.siteId = siteId || null;
    this.username = options.username || null;
    this.password = options.password || null;
    this.identityUrl = (
      options.identityUrl ||
      process.env.SALTO_IDENTITY_URL ||
      DEFAULT_SALTO_IDENTITY_URL
    ).replace(/\/$/, "");
    this.scope = options.scope || DEFAULT_SALTO_SCOPE;
    this.defaultTimeout = options.defaultTimeout || 30000;

    this._token = null;
    this._tokenExpiresAt = 0;
  }

  /**
   * Returns a valid bearer token, requesting (or refreshing) it if needed.
   * @returns {Promise<string>}
   */
  async _getToken() {
    const now = Date.now();
    if (this._token && now < this._tokenExpiresAt - TOKEN_REFRESH_SKEW_MS) {
      return this._token;
    }

    if (!this.username || !this.password) {
      throw new Error(
        "Salto KS requires a system user (username and password) for the password grant",
      );
    }

    const basic = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");

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

      this._token = accessToken;
      this._tokenExpiresAt = now + (expiresIn || 3600) * 1000;
      return this._token;
    } catch (err) {
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

  async getAccessPoints() {
    return this.getLocks();
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

  async createUser({ firstName, lastName, email }, siteId = this.siteId) {
    const resolvedSiteId = await this._resolveSiteId(siteId);
    return this._request("post", `/v1.2/sites/${resolvedSiteId}/users`, {
      firstName,
      lastName,
      email,
    });
  }

  async assignAccess(
    userId,
    lockIds,
    validFrom,
    validTo,
    pin = null,
    siteId = this.siteId,
  ) {
    const resolvedSiteId = await this._resolveSiteId(siteId);
    const payload = {
      lockIds: Array.isArray(lockIds) ? lockIds : [lockIds],
      validFrom,
      validTo,
    };

    if (pin != null) {
      payload.pin = pin;
    }

    return this._request(
      "post",
      `/v1.2/sites/${resolvedSiteId}/users/${userId}/access`,
      payload,
    );
  }

  async revokeAccess(accessId, siteId = this.siteId) {
    const resolvedSiteId = await this._resolveSiteId(siteId);
    return this._request(
      "delete",
      `/v1.2/sites/${resolvedSiteId}/access/${accessId}`,
    );
  }

  async deleteUser(userId, siteId = this.siteId) {
    const resolvedSiteId = await this._resolveSiteId(siteId);
    return this._request(
      "delete",
      `/v1.2/sites/${resolvedSiteId}/users/${userId}`,
    );
  }

  async subscribeNotifications(
    callbackUrl,
    eventTypes = [],
    siteId = this.siteId,
  ) {
    const resolvedSiteId = await this._resolveSiteId(siteId);
    return this._request("post", `/v1.2/sites/${resolvedSiteId}/subscriptions`, {
      callbackUrl,
      eventTypes,
    });
  }

  async unsubscribeNotifications(subscriptionId, siteId = this.siteId) {
    const resolvedSiteId = await this._resolveSiteId(siteId);
    return this._request(
      "delete",
      `/v1.2/sites/${resolvedSiteId}/subscriptions/${subscriptionId}`,
    );
  }

  // Aliases to satisfy the common notification interface of BaseAccessApiClient.
  async registerNotification(callbackUrl) {
    return this.subscribeNotifications(callbackUrl);
  }

  async unregisterNotification(notificationId) {
    return this.unsubscribeNotifications(notificationId);
  }

  static get capabilities() {
    return [
      "getLocks",
      "getAccessPoints",
      "openLock",
      "createUser",
      "assignAccess",
      "revokeAccess",
      "deleteUser",
      "subscribeNotifications",
      "unsubscribeNotifications",
    ];
  }

  static async testConnection(
    clientId,
    clientSecret,
    siteId,
    apiBaseUrl = DEFAULT_SALTO_API_BASE_URL,
    options = {},
  ) {
    const client = new SaltoKsApiClient(
      clientId,
      clientSecret,
      siteId,
      apiBaseUrl,
      options,
    );

    try {
      // Token request validates the credentials; listing locks validates the
      // site scope when a siteId is configured.
      await client._getToken();
      if (siteId) {
        const test = await client.getLocks(siteId);
      }
      return { success: true, message: "Connection successful" };
    } catch (err) {
      return BaseAccessApiClient.handleConnectionError(err);
    }
  }

  async _request(method, path, data = null, options = {}) {
    const token = await this._getToken();
    const url = `${this.baseUrl}${path}`;
    const config = {
      method,
      url,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      timeout: options.timeout || this.defaultTimeout,
    };

    if (data) {
      config.data = data;
    }

    try {
      const response = await axios.request(config);
      return response.data;
    } catch (err) {
      logger.error(
        `Salto KS API request failed: ${method.toUpperCase()} ${path} - ${err.message}`,
      );
      throw err;
    }
  }

  _extractList(value) {
    if (Array.isArray(value)) {
      return value;
    }

    return value?.items || value?.data || value?.locks || [];
  }
}

module.exports = {
  SaltoKsApiClient,
  DEFAULT_SALTO_API_BASE_URL,
  DEFAULT_SALTO_IDENTITY_URL,
  DEFAULT_SALTO_SCOPE,
};
