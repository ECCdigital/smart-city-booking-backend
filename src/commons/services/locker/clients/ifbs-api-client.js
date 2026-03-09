const axios = require("axios");
const bunyan = require("bunyan");
const BaseLockerApiClient = require("./base-locker-api-client");

const logger = bunyan.createLogger({
  name: "ifbs-api-client.js",
  level: process.env.LOG_LEVEL,
});

class IfbsApiClient extends BaseLockerApiClient {
  constructor(serverUrl, apiKey) {
    super(serverUrl);
    this.apiKey = apiKey;
  }

  async getLocationsStat() {
    const response = await this._get("getLocationsStat.php");
    return response.cities || [];
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

  async getPrice(locationId) {
    const response = await this._get("getPrice.php", {
      location: locationId,
    });
    const { success, ...pricing } = response;
    return pricing;
  }

  async getBox(locationId, start, end, userID = 1) {
    console.log("Requesting box with params:", {
      locationId,
      start,
      end,
      userID,
    })
    try {
      const response = await this._get("getBox.php", {
        location: locationId,
        DATEfrom: start,
        DATEto: end,
        User_ID: userID,
      });
      console.log("Received box response:", response);
      const { success, ...boxInfo } = response;
      return boxInfo;
    } catch (err) {
      logger.error(`Error in getBox: ${err.message}`);
      throw err;
    }
  }

  async bookIt(bookingID, checksum) {

    console.log("Booking with params:", {
      bookingID,
      checksum,
    })

    const response = await this._get("bookIt.php", {
      ID: bookingID,
      c: checksum,
    });
    const { success, ...bookingResult } = response;
    console.log("Booking result:", bookingResult);
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
    return response;
  }

  static get capabilities() {
    return ["getLocations", "getLocationsStat", "getLocationById", "getPrice" , "getBox", "bookIt", "extendUsage", "confirmExtension"];
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
  async _get(endpoint, params = {}) {
    const url = `${this.baseUrl}/${endpoint}`;
    try {
      const response = await axios.get(url, {
        params: { key: this.apiKey, ...params },
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });

      const data = response.data;
      if (data.success === "false" || data.success === false) {
        throw new Error(
          `IFBS API error on ${endpoint}: ${JSON.stringify(data)}`,
        );
      }

      return data;
    } catch (err) {
      logger.error(`IFBS API request failed: ${endpoint} - ${err.message}`);
      throw err;
    }
  }
}

module.exports = IfbsApiClient;
