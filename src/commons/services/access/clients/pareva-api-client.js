const axios = require("axios");
const bunyan = require("bunyan");
const BaseAccessApiClient = require("./base-access-api-client");

const logger = bunyan.createLogger({
  name: "pareva-api-client.js",
  level: process.env.LOG_LEVEL,
});

/**
 * The Pareva locker API of one locker system (`lockerId`), spoken with
 * basic auth. A rental is Pareva's word for one compartment handed to one
 * person: starting it makes Pareva mail the access code to that person
 * itself, so the platform never learns a code and never opens a
 * compartment.
 */
class ParevaApiClient extends BaseAccessApiClient {
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

  /**
   * The sizes (products) the locker system offers, as
   * `GET /locker/{lockerId}/available` lists them under `availableSizes`.
   *
   * @returns {Promise<Object[]>} The sizes, each with its `size` id
   */
  async listSizes() {
    const data = await this._request(
      "get",
      `/locker/${this.lockerId}/available`,
    );
    return data.availableSizes || [];
  }

  async getLocations() {
    return this.listSizes();
  }

  async getLocationById(locationId) {
    const locations = await this.getLocations();
    return locations.find((l) => l.size === locationId) || null;
  }

  /**
   * Asks how many compartments of a product are free in a window:
   * `POST /locker/{lockerId}/rental/available?v=2`. Pareva answers one
   * `ProductAssignment` per free compartment, so the caller counts the
   * entries; the platform's holds are not in the answer, Pareva learns of a
   * booking only when its rental starts.
   *
   * @param {string} productId The product, a 24-hex id at Pareva
   * @param {number} begin Start of the window, epoch ms
   * @param {number} end End of the window, epoch ms
   * @returns {Promise<Object[]>} The free compartments, one entry each
   * @throws {Error} Pareva's own error, or one of our own when the answer
   *   is no list
   */
  async getAvailableAssignments(productId, begin, end) {
    const entries = await this._request(
      "post",
      `/locker/${this.lockerId}/rental/available?v=2`,
      JSON.stringify({
        productId,
        begin: new Date(begin).getTime(),
        end: new Date(end).getTime(),
      }),
    );

    if (!Array.isArray(entries)) {
      throw new Error(
        `Pareva answered the availability of product '${productId}' without a list`,
      );
    }

    return entries;
  }

  /**
   * Starts a rental of one compartment of the given product:
   * `POST /locker/{lockerId}/rental/{productId}/open`. Pareva answers with
   * the `processId` of the rental and mails the access code to `email`.
   *
   * @param {string} productId The product to rent
   * @param {Object} rental
   * @param {string} rental.email Who rents, and gets the code from Pareva
   * @param {string} rental.fromEmail The tenant's address Pareva mails from
   * @param {number} rental.plannedBegin Start of the rental, epoch ms
   * @param {number} rental.plannedEnd End of the rental, epoch ms
   * @returns {Promise<Object>} Pareva's answer, with `processId`
   */
  async startRental(productId, { email, fromEmail, plannedBegin, plannedEnd }) {
    const begin = new Date(plannedBegin).getTime();
    const end = new Date(plannedEnd).getTime();

    return this._request(
      "post",
      `/locker/${this.lockerId}/rental/${productId}/open`,
      JSON.stringify({
        managerAssignment: false,
        email,
        plannedBegin: `${begin}`,
        date_estimate_delivery: `${end - begin}`,
        fromEmail,
        itemName: "",
        additionalInfo: {},
      }),
    );
  }

  /**
   * Cancels a rental: `POST /locker/{lockerId}/process/{processId}/cancel`.
   *
   * @param {string} processId The rental's process
   * @returns {Promise<Object>} Pareva's answer, `success: true` when the
   *   rental is cancelled
   */
  async cancelRental(processId) {
    return this._request(
      "post",
      `/locker/${this.lockerId}/process/${processId}/cancel`,
    );
  }

  static get capabilities() {
    return [
      "getLocations",
      "getLocationById",
      "listSizes",
      "getAvailableAssignments",
      "startRental",
      "cancelRental",
    ];
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
      return BaseAccessApiClient.handleConnectionError(err);
    }
  }

  /**
   * Internal HTTP helper. All requests go through here.
   * @param {string} method
   * @param {string} path
   * @param {Object|string|null} [data=null]
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
