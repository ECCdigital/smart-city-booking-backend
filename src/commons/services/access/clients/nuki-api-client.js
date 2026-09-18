const axios = require("axios");
const bunyan = require("bunyan");
const BaseAccessApiClient = require("./base-access-api-client");

const NUKI_ACTIONS = Object.freeze({
  UNLOCK: 1,
  LOCK: 2,
  UNLATCH: 3,
  LOCK_N_GO: 4,
  LOCK_N_GO_UNLATCH: 5,
});

// The Öffnungsart of a Nuki access point (`config.openAction`): the word the
// API and the admin UI use. `auto` is the platform's per-device choice and
// has no Nuki action number of its own; a missing key reads as `auto`.
const NUKI_OPEN_ACTIONS = Object.freeze({
  AUTO: "auto",
  UNLOCK: "unlock",
  UNLATCH: "unlatch",
  LOCK_N_GO: "lock_n_go",
  LOCK_N_GO_UNLATCH: "lock_n_go_unlatch",
});

// Öffnungsart word -> the Nuki action the provider sends for it.
const NUKI_OPEN_ACTION_NUMBERS = Object.freeze({
  [NUKI_OPEN_ACTIONS.UNLOCK]: NUKI_ACTIONS.UNLOCK,
  [NUKI_OPEN_ACTIONS.UNLATCH]: NUKI_ACTIONS.UNLATCH,
  [NUKI_OPEN_ACTIONS.LOCK_N_GO]: NUKI_ACTIONS.LOCK_N_GO,
  [NUKI_OPEN_ACTIONS.LOCK_N_GO_UNLATCH]: NUKI_ACTIONS.LOCK_N_GO_UNLATCH,
});

// `type` of a smartlock authorization as the Web API numbers it.
const NUKI_AUTH_TYPES = Object.freeze({
  KEYPAD: 13,
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

const ALL_NUKI_OPEN_ACTIONS = Object.freeze(Object.values(NUKI_OPEN_ACTIONS));

// Which Öffnungsarten a device type can carry out. A lock on a door does all
// of them; a box has no door, so it can only unlock; an opener buzzes the
// door and knows neither unlock nor latch, so only `auto` is left.
const NUKI_OPEN_ACTIONS_BY_DEVICE_TYPE = Object.freeze({
  [NUKI_DEVICE_TYPES.SMART_LOCK_1_2]: ALL_NUKI_OPEN_ACTIONS,
  [NUKI_DEVICE_TYPES.BOX]: Object.freeze([
    NUKI_OPEN_ACTIONS.AUTO,
    NUKI_OPEN_ACTIONS.UNLOCK,
  ]),
  [NUKI_DEVICE_TYPES.OPENER]: Object.freeze([NUKI_OPEN_ACTIONS.AUTO]),
  [NUKI_DEVICE_TYPES.SMART_DOOR]: ALL_NUKI_OPEN_ACTIONS,
  [NUKI_DEVICE_TYPES.SMART_LOCK_3_4]: ALL_NUKI_OPEN_ACTIONS,
  [NUKI_DEVICE_TYPES.SMART_LOCK_ULTRA]: ALL_NUKI_OPEN_ACTIONS,
});

// What `auto` opens a device type with: every device that sits at a door
// opens it - a lock pulls its latch, an opener buzzes the door, both of which
// are action 3 (action 1 only releases the bolt, and at an opener it merely
// arms Ring-to-Open). A box has no door to open, so it unlocks.
const NUKI_AUTO_OPEN_ACTION_BY_DEVICE_TYPE = Object.freeze({
  [NUKI_DEVICE_TYPES.SMART_LOCK_1_2]: NUKI_OPEN_ACTIONS.UNLATCH,
  [NUKI_DEVICE_TYPES.BOX]: NUKI_OPEN_ACTIONS.UNLOCK,
  [NUKI_DEVICE_TYPES.OPENER]: NUKI_OPEN_ACTIONS.UNLATCH,
  [NUKI_DEVICE_TYPES.SMART_DOOR]: NUKI_OPEN_ACTIONS.UNLATCH,
  [NUKI_DEVICE_TYPES.SMART_LOCK_3_4]: NUKI_OPEN_ACTIONS.UNLATCH,
  [NUKI_DEVICE_TYPES.SMART_LOCK_ULTRA]: NUKI_OPEN_ACTIONS.UNLATCH,
});

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

/**
 * The device type of a smartlock, as the Nuki Web API reports it: `type` is
 * its field, `config.deviceType` the older place to find it.
 *
 * @param {Object} smartlock A smartlock as returned by the Nuki API
 * @returns {number|null} The device type, or `null` where the lock names none
 */
function deviceTypeOf(smartlock) {
  return smartlock?.type ?? smartlock?.config?.deviceType ?? null;
}

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

  /**
   * Asks Nuki to create an authorization. Nuki does so asynchronously and
   * answers 204 without a body, so the created authorization - and its id -
   * is only to be had from {@link NukiApiClient#getAuthorizations}
   * afterwards.
   */
  async createAuthorization(smartlockId, authorization) {
    return this._request(
      "put",
      `/smartlock/${smartlockId}/auth`,
      authorization,
    );
  }

  /**
   * @param {string|number} smartlockId The smartlock to list for
   * @returns {Promise<Object[]>} The authorizations of the smartlock, each
   *   with `id`, `name`, `type`, `code` (keypad only) and `creationDate`
   */
  async getAuthorizations(smartlockId) {
    return this._request("get", `/smartlock/${smartlockId}/auth`);
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
    const type = deviceTypeOf(smartlock);
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

  /**
   * The device type of a lock as the Nuki Web API numbers it (0-5): `type`
   * is the documented field, `config.deviceType` the fallback for the
   * records that carry it there. `null` where the lock names neither - an
   * unknown type, not a type of its own. Public for the provider, which
   * names it in the save-time refusal of an Öffnungsart.
   *
   * @param {Object} smartlock A smartlock as returned by the Nuki API
   * @returns {number|null} The device type, `null` when the lock does not say
   */
  static deviceTypeOfSmartlock(smartlock) {
    return deviceTypeOf(smartlock);
  }

  /**
   * The Öffnungsarten this lock can carry out, by device type - the single
   * source of that capability, read by the provider listing. The device
   * type comes from `smartlock.type`, falling back to `config.deviceType`.
   *
   * A lock whose type is missing or unknown is answered with all five: an
   * unknown capability is not a missing one, and the device itself refuses
   * an action it cannot do.
   *
   * @param {Object} smartlock A smartlock as returned by the Nuki API
   * @returns {string[]} The supported open actions, `auto` always among them
   */
  static supportedOpenActionsForSmartlock(smartlock) {
    return [
      ...(NUKI_OPEN_ACTIONS_BY_DEVICE_TYPE[deviceTypeOf(smartlock)] ??
        ALL_NUKI_OPEN_ACTIONS),
    ];
  }

  /**
   * The Öffnungsart `auto` carries out at this lock, by device type - what
   * the platform means by "open it the way this device opens".
   *
   * A lock whose type is missing or unknown is answered with `null`: there
   * is no device to read the intent off, and the caller says what to do
   * without one.
   *
   * @param {Object} smartlock A smartlock as returned by the Nuki API
   * @returns {string|null} `unlatch` or `unlock`, or `null` for a device
   *   type this client does not know
   */
  static autoOpenActionForSmartlock(smartlock) {
    return (
      NUKI_AUTO_OPEN_ACTION_BY_DEVICE_TYPE[deviceTypeOf(smartlock)] ?? null
    );
  }

  /**
   * Read the position of a smartlock out of its `config`. Nuki keeps latitude
   * and longitude on every smartlock but has no address for it, so the result
   * carries coordinates only. Locks that were never positioned report 0/0,
   * which is treated as "no location" rather than as a spot in the Atlantic.
   *
   * @param {Object} smartlock A smartlock as returned by the Nuki API
   * @returns {Object|null} A location with coordinates, or null if unknown
   */
  static getLocationForSmartlock(smartlock) {
    const { latitude, longitude } = smartlock?.config || {};

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return null;
    }

    if (latitude === 0 && longitude === 0) {
      return null;
    }

    return { coordinates: { type: "Point", points: [longitude, latitude] } };
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
      "getAuthorizations",
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
  NUKI_OPEN_ACTIONS,
  NUKI_OPEN_ACTION_NUMBERS,
  ALL_NUKI_OPEN_ACTIONS,
  NUKI_DEVICE_TYPES,
  NUKI_NON_REMOTE_TYPES,
  NUKI_LOCK_STATES,
  NUKI_DOOR_STATES,
  NUKI_OPEN_LOCK_STATES,
  DEFAULT_NUKI_API_BASE_URL,
  NUKI_AUTH_TYPES,
};
