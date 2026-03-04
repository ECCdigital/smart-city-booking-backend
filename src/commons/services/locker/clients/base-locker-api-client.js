class BaseLockerApiClient {
  constructor(serverUrl) {
    this.baseUrl = serverUrl.replace(/\/$/, "");
  }

  async getLocations() {
    throw new Error(
      `getLocations() is not supported by ${this.constructor.name}`,
    );
  }

  async getLocationsStat() {
    throw new Error(
      `getLocationsStat() is not supported by ${this.constructor.name}`,
    );
  }

  async getLocationById(_locationId) {
    throw new Error(
      `getLocationById() is not supported by ${this.constructor.name}`,
    );
  }

  async getPrice(_locationId) {
    throw new Error(
      `getPrice() is not supported by ${this.constructor.name}`,
    );
  }

  static get capabilities() {
    return [];
  }

  /**
   * Shared error mapping for test connections.
   * @param {Error} err
   * @returns {{success: boolean, message: string}}
   */
  static handleConnectionError(err) {
    const networkErrors = {
      ECONNABORTED: "Connection timed out",
      ENOTFOUND: "Server not found",
      ECONNREFUSED: "Connection refused",
    };

    if (networkErrors[err.code]) {
      return { success: false, message: networkErrors[err.code] };
    }

    const httpErrors = {
      401: "Invalid credentials",
      403: "Access denied",
      404: "Resource not found",
    };

    if (err.response?.status && httpErrors[err.response.status]) {
      return { success: false, message: httpErrors[err.response.status] };
    }

    return { success: false, message: err.message };
  }
}

module.exports = BaseLockerApiClient;