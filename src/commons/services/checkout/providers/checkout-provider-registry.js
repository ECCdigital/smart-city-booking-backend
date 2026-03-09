class CheckoutProviderRegistry {
  constructor() {
    this._providers = new Map();
  }

  register(key, ProviderClass) {
    this._providers.set(key, ProviderClass);
  }

  /**
   * @param {string} lockerSystem
   * @param {Object} client - Bereits instanziierter API-Client
   * @param {Object} context
   * @returns {BaseCheckoutProvider}
   */
  resolve(lockerSystem, client, context) {
    const ProviderClass = this._providers.get(lockerSystem);

    if (!ProviderClass) {
      throw new Error(
        `No checkout provider registered for "${lockerSystem}". ` +
        `Available: [${[...this._providers.keys()].join(", ")}]`,
      );
    }

    return new ProviderClass(client, context);
  }

  has(key) {
    return this._providers.has(key);
  }
}

const registry = new CheckoutProviderRegistry();
module.exports = registry;