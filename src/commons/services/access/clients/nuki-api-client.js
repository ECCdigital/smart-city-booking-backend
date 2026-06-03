const axios = require("axios");
const bunyan = require("bunyan");
const BaseAccessApiClient = require("./base-access-api-client");

const NUKI_ACTIONS = Object.freeze({
  UNLOCK: 1,
  LOCK: 2,
  UNLATCH: 3,
  LOCK_N_GO: 4,
});

const DEFAULT_NUKI_API_BASE_URL = "https://api.nuki.io";

const logger = bunyan.createLogger({
  name: "nuki-api-client.js",
  level: process.env.LOG_LEVEL,
});

class NukiApiClient extends BaseAccessApiClient {
  constructor(apiToken, apiBaseUrl = DEFAULT_NUKI_API_BASE_URL, options = {}) {
    super(apiBaseUrl || DEFAULT_NUKI_API_BASE_URL);
    this.apiToken = apiToken;
    this.defaultTimeout = options.defaultTimeout || 30000;
  }

  async getSmartlocks() {
    return this._request("get", "/smartlock");
  }

  async getAccessPoints() {
    return this.getSmartlocks();
  }

  async executeAction(smartlockId, action) {
    return this._request("post", `/smartlock/${smartlockId}/action`, {
      action,
    });
  }

  async getSmartlockState(smartlockId) {
    return this._request("get", `/smartlock/${smartlockId}/state`);
  }

  async getStatus(smartlockId) {
    return this.getSmartlockState(smartlockId);
  }

  async createAuthorization(smartlockId, authorization) {
    return this._request("put", `/smartlock/${smartlockId}/auth`, authorization);
  }

  async deleteAuthorization(smartlockId, authorizationId) {
    return this._request(
      "delete",
      `/smartlock/${smartlockId}/auth/${authorizationId}`,
    );
  }

  async registerNotification(callbackUrl) {
    return this._request("post", "/callback/add", { url: callbackUrl });
  }

  async unregisterNotification(notificationId) {
    return this._request("post", "/callback/remove", { id: notificationId });
  }

  static get capabilities() {
    return [
      "getSmartlocks",
      "getAccessPoints",
      "executeAction",
      "getSmartlockState",
      "getStatus",
      "createAuthorization",
      "deleteAuthorization",
      "registerNotification",
      "unregisterNotification",
    ];
  }

  static async testConnection(apiToken, apiBaseUrl = DEFAULT_NUKI_API_BASE_URL) {
    const client = new NukiApiClient(apiToken, apiBaseUrl);

    try {
      await client._request("get", "/account");
      return { success: true, message: "Connection successful" };
    } catch (err) {
      return BaseAccessApiClient.handleConnectionError(err);
    }
  }

  async _request(method, path, data = null, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const config = {
      method,
      url,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiToken}`,
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
        `Nuki API request failed: ${method.toUpperCase()} ${path} - ${err.message}`,
      );
      throw err;
    }
  }
}

module.exports = {
  NukiApiClient,
  NUKI_ACTIONS,
  DEFAULT_NUKI_API_BASE_URL,
};
