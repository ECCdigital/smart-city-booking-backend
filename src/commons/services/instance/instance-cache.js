const NodeCache = require("node-cache");

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

const KEYS = {
  branding: "instance:branding",
  portal: "instance:portal",
  customerUploads: "instance:customerUploads",
};

class InstanceCache {
  static getBranding() {
    return cache.get(KEYS.branding);
  }

  static setBranding(branding) {
    cache.set(KEYS.branding, branding);
  }

  static getPortal() {
    return cache.get(KEYS.portal);
  }

  static setPortal(portal) {
    cache.set(KEYS.portal, portal);
  }

  static getCustomerUploads() {
    return cache.get(KEYS.customerUploads);
  }

  static setCustomerUploads(customerUploads) {
    cache.set(KEYS.customerUploads, customerUploads);
  }

  static invalidate() {
    cache.del(KEYS.branding);
    cache.del(KEYS.portal);
    cache.del(KEYS.customerUploads);
  }
}

module.exports = { InstanceCache };
