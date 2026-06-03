class AccessProvider {
  async open(accessPoint, bookingContext) {
    throw new Error(`open() is not supported by ${this.constructor.name}`);
  }

  async close(accessPoint, bookingContext) {
    throw new Error(`close() is not supported by ${this.constructor.name}`);
  }

  async getStatus(accessPoint, bookingContext) {
    throw new Error(`getStatus() is not supported by ${this.constructor.name}`);
  }

  async grantAuthorization(accessPoint, bookingContext) {
    throw new Error(
      `grantAuthorization() is not supported by ${this.constructor.name}`,
    );
  }

  async revokeAuthorization(accessPoint, bookingContext) {
    throw new Error(
      `revokeAuthorization() is not supported by ${this.constructor.name}`,
    );
  }

  async listAccessPoints(tenant) {
    throw new Error(
      `listAccessPoints() is not supported by ${this.constructor.name}`,
    );
  }

  async registerWebhook(tenant, callbackUrl) {
    throw new Error(
      `registerWebhook() is not supported by ${this.constructor.name}`,
    );
  }

  async unregisterWebhook(tenant) {
    throw new Error(
      `unregisterWebhook() is not supported by ${this.constructor.name}`,
    );
  }

  parseWebhook(_rawPayload, _headers) {
    throw new Error(
      `parseWebhook() is not supported by ${this.constructor.name}`,
    );
  }

  verifyWebhookSignature(_rawPayload, _headers, _secret) {
    throw new Error(
      `verifyWebhookSignature() is not supported by ${this.constructor.name}`,
    );
  }

  static get capabilities() {
    return [];
  }
}

module.exports = AccessProvider;
