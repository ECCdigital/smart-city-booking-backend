const axios = require("axios");
const bunyan = require("bunyan");
const BaseLockerApiClient = require("./base-locker-api-client");
const IfbsApiError = require("./ifbs-api-error");

const logger = bunyan.createLogger({
  name: "ifbs-api-client.js",
  level: process.env.LOG_LEVEL,
});

class IfbsApiClient extends BaseLockerApiClient {
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
    return response.cities || [];
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

  async monitorOpenBox(openBoxID) {
    const response = await this._get("monitorOpenBox.php", {
      OpenBox_ID: openBoxID,
    });
    const { success, ...result } = response;
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
      "monitorOpenBox",
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
      return BaseLockerApiClient.handleConnectionError(err);
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
