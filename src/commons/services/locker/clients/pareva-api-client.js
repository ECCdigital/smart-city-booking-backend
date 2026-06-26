const axios = require("axios");
const bunyan = require("bunyan");
const BaseLockerApiClient = require("./base-locker-api-client");

const logger = bunyan.createLogger({
  name: "pareva-api-client.js",
  level: process.env.LOG_LEVEL,
});

class ParevaApiClient extends BaseLockerApiClient {
  /**
   * @param {string} serverUrl
   * @param {string} lockerId
   * @param {string} user
   * @param {string} password
   */
  constructor(serverUrl, lockerId, user, password) {
    super(serverUrl);
    this.lockerId = lockerId;
    this.base64Credentials = Buffer.from(`${user}:${password}`).toString(
      "base64",
    );
  }

  async getLocations() {
    const data = await this._request(
      "get",
      `/locker/${this.lockerId}/available`,
    );
    return data.availableSizes || [];
  }

  async getLocationById(locationId) {
    const locations = await this.getLocations();
    return locations.find((l) => l.size === locationId) || null;
  }

  static get capabilities() {
    return ["getLocations", "getLocationById"];
  }

  /**
   * Tests the connection with the given credentials.
   *
   * @param {string} serverUrl
   * @param {string} lockerId
   * @param {string} user
   * @param {string} password
   * @returns {Promise<{success: boolean, message: string}>}
   */
  static async testConnection(serverUrl, lockerId, user, password) {
    const client = new ParevaApiClient(serverUrl, lockerId, user, password);
    try {
      const data = await client._request(
        "get",
        `/locker/${lockerId}/available`,
      );

      if (!data || data.error === true || data.success === false) {
        return {
          success: false,
          message: data?.reason || "Invalid response from server",
        };
      }

      if (data.availableSizes) {
        return { success: true, message: "Connection successful" };
      }

      return { success: false, message: "Unexpected response format" };
    } catch (err) {
      return BaseLockerApiClient.handleConnectionError(err);
    }
  }

  /**
   * Internal HTTP helper. All requests go through here.
   * @param {string} method
   * @param {string} path
   * @param {Object|null} [data=null]
   * @returns {Object}
   * @private
   */
  async _request(method, path, data = null) {
    const url = `${this.baseUrl}${path}`;
    try {
      const config = {
        method,
        url,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${this.base64Credentials}`,
        },
        timeout: 10000,
      };

      if (data) {
        config.data = data;
      }

      const response = await axios.request(config);
      return response.data;
    } catch (err) {
      logger.error(
        `Pareva API request failed: ${method.toUpperCase()} ${path} - ${err.message}`,
      );
      throw err;
    }
  }
}

module.exports = ParevaApiClient;
