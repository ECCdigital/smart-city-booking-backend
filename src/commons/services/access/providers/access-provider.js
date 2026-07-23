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

  static get capabilities() {
    return [];
  }
}

module.exports = AccessProvider;
