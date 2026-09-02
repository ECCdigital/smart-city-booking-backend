const axios = require("axios");
const crypto = require("crypto");
const bunyan = require("bunyan");
const BaseAccessApiClient = require("./base-access-api-client");
const IfbsApiError = require("./ifbs-api-error");

const logger = bunyan.createLogger({
  name: "ifbs-api-client.js",
  level: process.env.LOG_LEVEL,
});

/**
 * The iFBS bike box API: one GET per command, the API key as a query
 * parameter, and every answer carrying `success` as a string. An answer
 * with `success: "false"` is raised as an {@link IfbsApiError} with the
 * error number and message iFBS gives.
 */
class IfbsApiClient extends BaseAccessApiClient {
  constructor(serverUrl, apiKey, secretPhrase, options = {}) {
    super(serverUrl);
    this.apiKey = apiKey;
    this.secretPhrase = secretPhrase;
    this.defaultTimeout = options.defaultTimeout || 30000;
  }

  async getLocationsStat(locationId) {
    const response = await this._get("getLocationsStat.php");

    const allLocations = response.cities.flatMap(
      (city) => city.locations || [],
    );

    const requestedLocation = allLocations.find(
      (loc) => loc.LocationID === locationId,
    );

    return requestedLocation || null;
  }

  async getLocations() {
    const response = await this._get("getLocations.php");
    const filteredCities = response.cities.filter(
      (city) => city.CityID === "35",
    );
    return filteredCities || [];
  }

  async getLocationById(locationId) {
    const response = await this._get("getLocationsbyId.php", {
      locationId,
    });
    return response.location || null;
  }

  async getBookings(locationId) {
    const response = await this._get("getBookings4Location.php", {
      LocationID: locationId,
    });
    return response.boxes || [];
  }

  async getPrice(locationId) {
    const response = await this._get("getPrice.php", {
      location: locationId,
    });
    const { success, ...pricing } = response;
    return pricing;
  }

  async getBox(locationId, start, end, userID = 1) {
    try {
      const response = await this._get("getBox.php", {
        location: locationId,
        DATEfrom: start,
        DATEto: end,
        User_ID: userID,
      });
      const { success, ...boxInfo } = response;
      return boxInfo;
    } catch (err) {
      logger.error(`Error in getBox: ${err.message}`);
      throw err;
    }
  }

  async bookIt(bookingID, checksum) {
    const response = await this._get("bookIt.php", {
      ID: bookingID,
      c: checksum,
    });
    const { success, ...bookingResult } = response;
    return bookingResult;
  }

  async extendUsage(bookingID, dateTo) {
    const response = await this._get("extendUsage.php", {
      ID: bookingID,
      ...(dateTo ? { DATEto: dateTo } : {}),
    });
    return response;
  }

  async confirmExtension(bookingID, extensionId) {
    const response = await this._get("extendUsage.php", {
      ID: bookingID,
      Extension_ID: extensionId,
    });
    console.error(
      `ConfirmExtension response for booking ${bookingID} and extension ${extensionId}:`,
      response,
    );
    return response;
  }

  async cancelUsage(bookingID) {
    const response = await this._get("cancelUsage.php", {
      ID: bookingID,
    });
    return response;
  }

  async endUsage(bookingID, dateTo) {
    const response = await this._get("endUsage.php", {
      ID: bookingID,
      ...(dateTo ? { DATEto: dateTo } : {}),
    });
    return response;
  }

  async openBox(bookingID) {
    const response = await this._get("openBox.php", {
      ID: bookingID,
    });
    const { success, ...result } = response;
    logger.info(`OpenBox command sent for booking ${bookingID}`);
    return result;
  }

  async waitForOpenBox(openBoxID, timeout = 20) {
    const response = await this._get(
      "waitForOpenBox.php",
      {
        OpenBox_ID: openBoxID,
        TimeOut: timeout,
      },
      { timeout: (timeout + 10) * 1000 },
    );
    const { success, ...result } = response;
    return result;
  }

  /**
   * The `User_ID` iFBS is told on `getBox`: the platform user's database id
   * behind a fixed prefix, or `1` - the anonymous user - when the booking
   * has no user the platform knows.
   *
   * @param {Object|null} rawUser The user as `UserManager.getRawUser`
   *   answers it, or nothing
   * @returns {string|number}
   */
  static userId(rawUser) {
    if (!rawUser?._id) {
      return 1;
    }
    return `01${rawUser._id.toString()}`;
  }

  /**
   * A timestamp as iFBS takes it: "YYYY-MM-DD HH:mm", local time.
   *
   * @param {number|Date} timestamp
   * @returns {string}
   */
  static formatDate(timestamp) {
    const d = new Date(timestamp);
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-` +
      `${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }

  /**
   * The checksum `bookIt` proves a booking with, as the iFBS specification
   * has it: md5(nummer + urlEncode(DATEfrom) + urlEncode(DATEto) +
   * secretPhrase).
   *
   * @param {string|number} nummer The box number `getBox` answered
   * @param {string} dateFrom As of {@link IfbsApiClient.formatDate}
   * @param {string} dateTo As of {@link IfbsApiClient.formatDate}
   * @param {string} secretPhrase The tenant's iFBS secret phrase
   * @returns {string}
   */
  static checksum(nummer, dateFrom, dateTo, secretPhrase) {
    const encode = (value) =>
      new URLSearchParams({ v: value }).toString().slice(2);

    const raw =
      String(nummer) + encode(dateFrom) + encode(dateTo) + secretPhrase;

    return crypto.createHash("md5").update(raw).digest("hex");
  }

  static get capabilities() {
    return [
      "getLocations",
      "getLocationsStat",
      "getLocationById",
      "getPrice",
      "getBox",
      "bookIt",
      "extendUsage",
      "confirmExtension",
      "cancelUsage",
      "endUsage",
      "openBox",
      "waitForOpenBox",
      "getBookings",
    ];
  }

  static async testConnection(serverUrl, apiKey) {
    const client = new IfbsApiClient(serverUrl, apiKey);
    try {
      const data = await client._get("getLocations.php");

      if (data.success === "true" || data.success === true) {
        return { success: true, message: "Connection successful" };
      }

      return {
        success: false,
        message: data.ErrMsg || "Unknown error",
        errorCode: data.ErrNo || null,
      };
    } catch (err) {
      return BaseAccessApiClient.handleConnectionError(err);
    }
  }

  /** @private */
  async _get(endpoint, params = {}, options = {}) {
    const url = `${this.baseUrl}/${endpoint}`;
    const timeout = options.timeout || this.defaultTimeout || 10000;
    try {
      const response = await axios.get(url, {
        params: { key: this.apiKey, ...params },
        headers: { "Content-Type": "application/json" },
        timeout,
      });

      const data = response.data;
      if (data.success === "false" || data.success === false) {
        throw new IfbsApiError(endpoint, data);
      }

      return data;
    } catch (err) {
      if (err instanceof IfbsApiError) throw err;
      logger.error(`IFBS API request failed: ${endpoint} - ${err.message}`);
      throw err;
    }
  }
}

module.exports = IfbsApiClient;
