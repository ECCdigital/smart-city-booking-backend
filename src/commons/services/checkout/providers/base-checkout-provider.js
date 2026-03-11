class BaseCheckoutProvider {
  /**
   * @param {Object} client - Bereits instanziierter API-Client
   * @param {Object} context - { bookable, unit, timeBegin, timeEnd, amount, tenantId }
   */
  constructor(client, context) {
    this.userID = context.userID;
    this.client = client;
    this.bookable = context.bookable;
    this.unit = context.unit;
    this.timeBegin = context.timeBegin;
    this.timeEnd = context.timeEnd;
    this.amount = context.amount;
    this.tenantId = context.tenantId;
    this._cache = new Map();
  }

  _cached(key, fn) {
    if (!this._cache.has(key)) {
      this._cache.set(key, fn());
    }
    return this._cache.get(key);
  }

  async checkAvailability() {
    throw new Error("checkAvailability() not implemented");
  }

  async getPriceEur() {
    throw new Error("getPriceEur() not implemented");
  }

  async getGrossPriceEur() {
    throw new Error("getGrossPriceEur() not implemented");
  }

  get handlesPricing() {
    return false;
  }

  get handlesAvailability() {
    return false;
  }
}

module.exports = BaseCheckoutProvider;