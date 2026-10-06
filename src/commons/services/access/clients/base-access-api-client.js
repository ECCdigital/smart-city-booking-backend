class BaseAccessApiClient {
  constructor(apiBaseUrl) {
    this.baseUrl = apiBaseUrl.replace(/\/$/, "");
  }

  async getAccessPoints() {
    throw new Error(
      `getAccessPoints() is not supported by ${this.constructor.name}`,
    );
  }

  async executeAction(_accessPointId, _action) {
    throw new Error(
      `executeAction() is not supported by ${this.constructor.name}`,
    );
  }

  async getStatus(_accessPointId) {
    throw new Error(`getStatus() is not supported by ${this.constructor.name}`);
  }

  async createAuthorization(_accessPointId, _authorization) {
    throw new Error(
      `createAuthorization() is not supported by ${this.constructor.name}`,
    );
  }

  async deleteAuthorization(_accessPointId, _authorizationId) {
    throw new Error(
      `deleteAuthorization() is not supported by ${this.constructor.name}`,
    );
  }

  async registerNotification(_callbackUrl) {
    throw new Error(
      `registerNotification() is not supported by ${this.constructor.name}`,
    );
  }

  async unregisterNotification(_notificationId) {
    throw new Error(
      `unregisterNotification() is not supported by ${this.constructor.name}`,
    );
  }

  static get capabilities() {
    return [];
  }

  /**
   * Shared error mapping for access-provider connection tests.
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

module.exports = BaseAccessApiClient;
