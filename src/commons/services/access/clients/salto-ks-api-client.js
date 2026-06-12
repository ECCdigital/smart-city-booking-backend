const axios = require("axios");
const bunyan = require("bunyan");
const BaseAccessApiClient = require("./base-access-api-client");

const DEFAULT_SALTO_API_BASE_URL = "https://clp-accept-user.my-clay.com";
const DEFAULT_SALTO_IDENTITY_URL = "https://identity.eu.my-clay.com";
const DEFAULT_SALTO_SCOPE = "user_api.full_access";

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
 * Authentication uses the OpenID Connect token endpoint with the
 * client-credentials grant. The retrieved bearer token is cached in-memory
 * and transparently refreshed shortly before it expires.
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

    const basic = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");

    const body = new URLSearchParams({
      grant_type: "client_credentials",
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

  async getLocks(siteId = this.siteId) {
    return this._request("get", `/sites/${siteId}/locks`);
  }

  async getAccessPoints() {
    return this.getLocks();
  }

  async openLock(lockId, siteId = this.siteId) {
    return this._request("post", `/sites/${siteId}/locks/${lockId}/open`);
  }

  async createUser({ firstName, lastName, email }, siteId = this.siteId) {
    return this._request("post", `/sites/${siteId}/users`, {
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
      `/sites/${siteId}/users/${userId}/access`,
      payload,
    );
  }

  async revokeAccess(accessId, siteId = this.siteId) {
    return this._request("delete", `/sites/${siteId}/access/${accessId}`);
  }

  async deleteUser(userId, siteId = this.siteId) {
    return this._request("delete", `/sites/${siteId}/users/${userId}`);
  }

  async subscribeNotifications(callbackUrl, eventTypes = [], siteId = this.siteId) {
    return this._request("post", `/sites/${siteId}/subscriptions`, {
      callbackUrl,
      eventTypes,
    });
  }

  async unsubscribeNotifications(subscriptionId, siteId = this.siteId) {
    return this._request(
      "delete",
      `/sites/${siteId}/subscriptions/${subscriptionId}`,
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
        await client.getLocks(siteId);
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
}

module.exports = {
  SaltoKsApiClient,
  DEFAULT_SALTO_API_BASE_URL,
  DEFAULT_SALTO_IDENTITY_URL,
  DEFAULT_SALTO_SCOPE,
};
