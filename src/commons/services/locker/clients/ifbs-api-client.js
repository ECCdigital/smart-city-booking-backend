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

  static get capabilities() {
    return [
      "getLocations",
      "getLocationsStat",
      "getLocationById",
      "getPrice",
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
      logger.error(
        `IFBS API request failed: ${endpoint} - ${err.message}`,
      );
      throw err;
    }
  }
}

module.exports = IfbsApiClient;