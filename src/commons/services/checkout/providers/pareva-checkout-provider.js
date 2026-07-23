const BaseCheckoutProvider = require("./base-checkout-provider");

class ParevaCheckoutProvider extends BaseCheckoutProvider {
  get handlesPricing() {
    return false;
  }

  get handlesAvailability() {
    return false;
  }

  get handlesMaxAmount() {
    return false;
  }

  async checkAvailability() {
    return { available: true };
  }

  async getPriceEur() {
    return 0;
  }

  async getGrossPriceEur() {
    return 0;
  }
}

module.exports = ParevaCheckoutProvider;
