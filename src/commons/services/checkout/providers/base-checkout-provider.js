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
    this.externalCache = context.externalCache || new Map();
    this._cache = new Map();
  }

  /** Per-instance cache. */
  _cached(key, fn) {
    if (!this._cache.has(key)) {
      this._cache.set(key, fn());
    }
    return this._cache.get(key);
  }

  /**
   * Shared cache across all provider instances in the same
   * CalendarService.checkAvailability call.
   */
  _sharedCached(key, fn) {
    if (!this.externalCache.has(key)) {
      this.externalCache.set(key, fn());
    }
    return this.externalCache.get(key);
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

  async getExternalPriceCategories() {
    throw new Error("getExternalPriceCategories() not implemented");
  }

  async checkBookingDuration(durationMinutes) {
    return { available: true };
  }

  get handlesPricing() {
    return false;
  }

  get handlesAvailability() {
    return false;
  }

  get handlesMaxAmount() {
    return false;
  }

  get handlesBookingDuration() {
    return false;
  }
}

module.exports = BaseCheckoutProvider;