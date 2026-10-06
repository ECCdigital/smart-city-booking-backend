const NodeCache = require("node-cache");

const cache = new NodeCache({ stdTTL: 45, checkperiod: 60 });

class DashboardCache {
  static get(key) {
    return cache.get(key);
  }

  static set(key, value) {
    cache.set(key, value);
  }

  static invalidateAll() {
    cache.flushAll();
  }
}

module.exports = { DashboardCache };
