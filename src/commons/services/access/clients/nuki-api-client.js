const axios = require("axios");
const bunyan = require("bunyan");
const BaseAccessApiClient = require("./base-access-api-client");

const NUKI_ACTIONS = Object.freeze({
  UNLOCK: 1,
  LOCK: 2,
  UNLATCH: 3,
  LOCK_N_GO: 4,
});

const NUKI_DEVICE_TYPES = Object.freeze({
  SMART_LOCK_1_2: 0,
  BOX: 1,
  OPENER: 2,
  SMART_DOOR: 3,
  SMART_LOCK_3_4: 4,
  SMART_LOCK_ULTRA: 5,
});

const NUKI_NON_REMOTE_TYPES = Object.freeze([NUKI_DEVICE_TYPES.BOX]);

// Nuki smart lock states (state.state) as defined by the Nuki Web API.
const NUKI_LOCK_STATES = Object.freeze({
  0: "uncalibrated",
  1: "locked",
  2: "unlocking",
  3: "unlocked",
  4: "locking",
  5: "unlatched",
  6: "unlocked_lock_n_go",
  7: "unlatching",
  254: "motor_blocked",
  255: "undefined",
});

// States in which the lock grants access (door can be opened / is open).
const NUKI_OPEN_LOCK_STATES = Object.freeze([3, 5, 6, 7]);

// Nuki door sensor states (state.doorState).
const NUKI_DOOR_STATES = Object.freeze({
  0: "unavailable",
  1: "deactivated",
  2: "closed",
  3: "open",
  4: "unknown",
  5: "calibrating",
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

  async getSmartlock(smartlockId) {
    return this._request("get", `/smartlock/${smartlockId}`);
  }

  async getSmartlockState(smartlockId) {
    const smartlock = await this.getSmartlock(smartlockId);
    const lockStateCode = smartlock.state?.state ?? null;
    const doorStateCode = smartlock.state?.doorState ?? null;

    const lockState =
      lockStateCode != null
        ? NUKI_LOCK_STATES[lockStateCode] ?? "unknown"
        : null;
    const doorSensorState =
      doorStateCode != null
        ? NUKI_DOOR_STATES[doorStateCode] ?? "unknown"
        : null;

    const locked = lockStateCode != null ? lockStateCode === 1 : null;

    // Whether the door can currently be opened (lock is released).
    const open =
      lockStateCode != null
        ? NUKI_OPEN_LOCK_STATES.includes(lockStateCode)
        : null;

    // Physical door position, only available when a door sensor is installed.
    let doorOpen = null;
    if (doorStateCode === 3) {
      doorOpen = true;
    } else if (doorStateCode === 2) {
      doorOpen = false;
    }

    return {
      smartlockId: String(smartlock.smartlockId || smartlock.id || smartlockId),
      name: smartlock.name || smartlock.label || "",
      serverState: smartlock.serverState,
      locked,
      open,
      lockState,
      lockStateCode,
      doorOpen,
      doorSensorState,
      doorStateCode,
      state: smartlock.state || null,
      batteryCritical: smartlock.state?.batteryCritical ?? null,
      batteryCharging: smartlock.state?.batteryCharging ?? null,
      batteryCharge: smartlock.state?.batteryCharge ?? null,
      providerResponse: smartlock,
    };
  }

  async getStatus(smartlockId) {
    return this.getSmartlockState(smartlockId);
  }

  async createAuthorization(smartlockId, authorization) {
    return this._request(
      "put",
      `/smartlock/${smartlockId}/auth`,
      authorization,
    );
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

  static getCapabilitiesForSmartlock(smartlock) {
    const config = smartlock?.config || {};
    const type = smartlock?.type ?? config.deviceType ?? null;
    const capabilities = [];

    if (
      smartlock?.virtualDevice !== true &&
      !NUKI_NON_REMOTE_TYPES.includes(type)
    ) {
      capabilities.push("remote");
    }

    if (config.keypadPaired === true || config.keypad2Paired === true) {
      capabilities.push("authorization");
    }

    return capabilities;
  }

  static get capabilities() {
    return [
      "getSmartlocks",
      "getAccessPoints",
      "getSmartlock",
      "executeAction",
      "getSmartlockState",
      "getStatus",
      "createAuthorization",
      "deleteAuthorization",
      "registerNotification",
      "unregisterNotification",
    ];
  }

  static async testConnection(
    apiToken,
    apiBaseUrl = DEFAULT_NUKI_API_BASE_URL,
  ) {
    const client = new NukiApiClient(apiToken, apiBaseUrl);

    try {
      await client._request("get", "/smartlock");
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
  NUKI_DEVICE_TYPES,
  NUKI_NON_REMOTE_TYPES,
  NUKI_LOCK_STATES,
  NUKI_DOOR_STATES,
  NUKI_OPEN_LOCK_STATES,
  DEFAULT_NUKI_API_BASE_URL,
};
